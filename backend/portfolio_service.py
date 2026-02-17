"""
Portfolio service — virtual portfolio management with P&L, interest, and
inflation-adjusted return calculations.

Assumptions documented at the bottom of this file.
"""

from typing import Dict, List, Optional
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import case
import requests
import math
import logging

from database import Portfolio, Transaction, Holding
from market_data import get_live_price, get_usd_try_rate

logger = logging.getLogger(__name__)

# ── Bank FX rate helpers ─────────────────────────────────────────
_BANK_RATE_CACHE: Dict[str, tuple] = {}
BANK_RATE_TTL = 300  # 5 min cache


def get_bank_fx_rates() -> Dict:
    """
    Get bank-like buy/sell USD/TRY rates with realistic spread.
    Tries TCMB (Central Bank of Turkey) XML feed first,
    then falls back to mid-rate with ~1.5% spread.
    """
    cache = _BANK_RATE_CACHE.get("usdtry")
    if cache and (datetime.utcnow().timestamp() - cache[1]) < BANK_RATE_TTL:
        return cache[0]

    mid = get_usd_try_rate()
    try:
        # Try TCMB (Turkish Central Bank) for indicative rates
        url = "https://www.tcmb.gov.tr/kurlar/today.xml"
        r = requests.get(url, timeout=8, headers={
            "User-Agent": "Mozilla/5.0"
        })
        if r.status_code == 200 and "USD" in r.text:
            import xml.etree.ElementTree as ET
            root = ET.fromstring(r.content)
            for currency in root.findall('.//Currency'):
                if currency.get('Kod') == 'USD' or currency.get('CurrencyCode') == 'USD':
                    fb = currency.find('ForexBuying')
                    fs = currency.find('ForexSelling')
                    if fb is not None and fs is not None and fb.text and fs.text:
                        bid = float(fb.text)
                        ask = float(fs.text)
                        result = {
                            "bid": round(bid, 4),
                            "ask": round(ask, 4),
                            "mid": round((bid + ask) / 2, 4),
                            "spread_pct": round(((ask - bid) / bid) * 100, 3),
                            "source": "TCMB",
                        }
                        _BANK_RATE_CACHE["usdtry"] = (result, datetime.utcnow().timestamp())
                        return result
    except Exception as e:
        logger.warning("TCMB rate fetch failed: %s", e)

    # Fallback: apply realistic bank spread (~1.5%)
    spread = 0.015
    result = {
        "bid": round(mid * (1 - spread / 2), 4),
        "ask": round(mid * (1 + spread / 2), 4),
        "mid": round(mid, 4),
        "spread_pct": round(spread * 100, 3),
        "source": "estimated",
    }
    _BANK_RATE_CACHE["usdtry"] = (result, datetime.utcnow().timestamp())
    return result

# ── CPI / Inflation helpers ─────────────────────────────────────
_CPI_CACHE: Dict[str, tuple] = {}   # key → (data, timestamp)
CPI_CACHE_TTL = 86400               # 24 hours

# BLS Series ID for US CPI-U (All Urban Consumers, Seasonally Adjusted)
BLS_CPI_SERIES = "CUSR0000SA0"


def _fetch_cpi_data() -> List[Dict]:
    """
    Fetch quarterly US CPI data from BLS public API (no key required).
    Returns list of {"year": 2025, "quarter": 1, "value": 315.2, "period": "Q1 2025"}.
    """
    cache = _CPI_CACHE.get("quarterly")
    if cache and (datetime.utcnow().timestamp() - cache[1]) < CPI_CACHE_TTL:
        return cache[0]

    try:
        # BLS public API v2 — get last 5 years of monthly data
        end_year = datetime.utcnow().year
        start_year = end_year - 5
        url = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
        payload = {
            "seriesid": [BLS_CPI_SERIES],
            "startyear": str(start_year),
            "endyear": str(end_year),
        }
        r = requests.post(url, json=payload, timeout=15)
        if r.status_code != 200:
            return []

        data = r.json()
        series = data.get("Results", {}).get("series", [])
        if not series:
            return []

        monthly = series[0].get("data", [])

        # Group by quarter — take last month of each quarter (M03, M06, M09, M12)
        quarter_months = {"M03": 1, "M06": 2, "M09": 3, "M12": 4}
        quarterly: List[Dict] = []
        for entry in monthly:
            period = entry.get("period", "")
            if period in quarter_months:
                quarterly.append({
                    "year": int(entry["year"]),
                    "quarter": quarter_months[period],
                    "value": float(entry["value"]),
                    "period": f"Q{quarter_months[period]} {entry['year']}",
                })

        quarterly.sort(key=lambda x: (x["year"], x["quarter"]))
        _CPI_CACHE["quarterly"] = (quarterly, datetime.utcnow().timestamp())
        return quarterly

    except Exception as e:
        logger.warning("CPI data fetch failed: %s", e)
        return []


def _fetch_expected_cpi() -> Optional[Dict]:
    """
    Fetch expected CPI for the current (not yet published) quarter.
    Uses Cleveland Fed Inflation Expectations or falls back to a
    reasonable estimate from recent trend.
    """
    try:
        # Cleveland Fed Inflation Expectations (1-year expected)
        url = "https://www.clevelandfed.org/api/InflationExpectation/csv"
        r = requests.get(url, timeout=10)
        if r.status_code == 200 and r.text.strip():
            lines = r.text.strip().split("\n")
            if len(lines) > 1:
                last = lines[-1].split(",")
                if len(last) >= 2:
                    annual_expected = float(last[1])
                    return {"annual_rate": annual_expected, "source": "Cleveland Fed"}
    except Exception as e:
        logger.warning("Cleveland Fed CPI fetch failed: %s", e)

    # Fallback: use last 4 quarters average annualized rate
    data = _fetch_cpi_data()
    if len(data) >= 5:
        recent = data[-1]["value"]
        year_ago = data[-5]["value"]
        annual_rate = ((recent / year_ago) - 1) * 100
        return {"annual_rate": round(annual_rate, 2), "source": "BLS trailing 4Q"}

    return None


def _get_inflation_factor(from_date: datetime, to_date: datetime) -> float:
    """
    Calculate the inflation factor (purchasing power erosion) between two dates.

    Uses quarterly CPI data.  For partial quarters, exponentiates by
    (days_in_quarter_elapsed / total_days_in_quarter).

    Returns a multiplier < 1 if there's positive inflation (money lost value),
    > 1 if deflation.

    Example: factor = 0.95 means $1 at from_date is worth $0.95 at to_date
    in real terms.
    """
    cpi_data = _fetch_cpi_data()
    if not cpi_data:
        return 1.0  # no data, assume no inflation

    # Build quarter lookup
    cpi_map: Dict[str, float] = {}
    for entry in cpi_data:
        key = f"{entry['year']}-Q{entry['quarter']}"
        cpi_map[key] = entry["value"]

    def date_to_quarter(dt: datetime) -> tuple:
        q = (dt.month - 1) // 3 + 1
        return dt.year, q

    def quarter_start(year: int, q: int) -> datetime:
        return datetime(year, (q - 1) * 3 + 1, 1)

    def quarter_end(year: int, q: int) -> datetime:
        if q == 4:
            return datetime(year + 1, 1, 1)
        return datetime(year, q * 3 + 1, 1)

    def next_quarter(year: int, q: int) -> tuple:
        if q == 4:
            return year + 1, 1
        return year, q + 1

    from_y, from_q = date_to_quarter(from_date)
    to_y, to_q = date_to_quarter(to_date)

    factor = 1.0
    curr_y, curr_q = from_y, from_q

    while (curr_y, curr_q) <= (to_y, to_q):
        key = f"{curr_y}-Q{curr_q}"
        prev_y, prev_q = (curr_y, curr_q - 1) if curr_q > 1 else (curr_y - 1, 4)
        prev_key = f"{prev_y}-Q{prev_q}"

        cpi_curr = cpi_map.get(key)
        cpi_prev = cpi_map.get(prev_key)

        if cpi_curr and cpi_prev and cpi_prev > 0:
            quarterly_inflation = (cpi_curr / cpi_prev) - 1  # e.g. 0.008 for 0.8%

            # Fractional exponent for partial quarters
            qs = quarter_start(curr_y, curr_q)
            qe = quarter_end(curr_y, curr_q)
            total_days = (qe - qs).days

            if (curr_y, curr_q) == (from_y, from_q):
                # Partial: from deposit date to end of quarter
                days_in = (qe - from_date).days
            elif (curr_y, curr_q) == (to_y, to_q):
                # Partial: from start of quarter to today
                days_in = (to_date - qs).days
            else:
                days_in = total_days

            exponent = days_in / total_days if total_days > 0 else 1.0
            # Purchasing power erosion: divide by (1 + inflation)^exponent
            factor /= (1 + quarterly_inflation) ** exponent
        elif (curr_y, curr_q) == (to_y, to_q) and not cpi_curr:
            # Current quarter not published yet — use expected CPI
            expected = _fetch_expected_cpi()
            if expected:
                # Convert annual rate to quarterly
                annual = expected["annual_rate"] / 100
                quarterly_inflation = (1 + annual) ** 0.25 - 1
                qs = quarter_start(curr_y, curr_q)
                qe = quarter_end(curr_y, curr_q)
                total_days = (qe - qs).days
                days_in = (to_date - qs).days
                exponent = days_in / total_days if total_days > 0 else 1.0
                factor /= (1 + quarterly_inflation) ** exponent

        ny, nq = next_quarter(curr_y, curr_q)
        curr_y, curr_q = ny, nq

    return factor


# ── Portfolio operations ─────────────────────────────────────────

def get_or_create_portfolio(db: Session, username: str) -> Portfolio:
    """Get existing portfolio or create a new one."""
    portfolio = db.query(Portfolio).filter(Portfolio.username == username).first()
    if not portfolio:
        portfolio = Portfolio(username=username)
        db.add(portfolio)
        db.commit()
        db.refresh(portfolio)
    return portfolio


def deposit(db: Session, username: str, amount_try: float, transaction_date: Optional[str] = None) -> Dict:
    """
    Deposit TRY into portfolio. Converts to USD at the current rate.
    This USD value is what we track for P&L.
    """
    portfolio = get_or_create_portfolio(db, username)
    rate = get_usd_try_rate()
    amount_usd = round(amount_try / rate, 4)

    # Parse transaction_date if provided
    tx_date = None
    if transaction_date:
        try:
            tx_date = datetime.fromisoformat(transaction_date.replace('Z', '+00:00'))
        except:
            pass

    tx = Transaction(
        portfolio_id=portfolio.id,
        tx_type="deposit",
        amount_try=amount_try,
        amount_usd=amount_usd,
        usd_try_rate=rate,
        note=f"Deposited {amount_try:.2f} TRY at rate {rate:.4f}",
        transaction_date=tx_date,
    )
    db.add(tx)

    portfolio.total_deposited_try += amount_try
    portfolio.total_deposited_usd += amount_usd
    portfolio.cash_try += amount_try
    portfolio.updated_at = datetime.utcnow()

    db.commit()
    return {
        "status": "ok",
        "deposited_try": amount_try,
        "deposited_usd": round(amount_usd, 4),
        "rate": rate,
        "cash_try": round(portfolio.cash_try, 2),
        "cash_usd": round(portfolio.cash_usd, 4),
    }


def deposit_usd(db: Session, username: str, amount_usd: float, transaction_date: Optional[str] = None) -> Dict:
    """Deposit USD directly into portfolio."""
    portfolio = get_or_create_portfolio(db, username)
    rate = get_usd_try_rate()
    amount_try = round(amount_usd * rate, 2)

    # Parse transaction_date if provided
    tx_date = None
    if transaction_date:
        try:
            tx_date = datetime.fromisoformat(transaction_date.replace('Z', '+00:00'))
        except:
            pass

    tx = Transaction(
        portfolio_id=portfolio.id,
        tx_type="deposit",
        amount_try=amount_try,
        amount_usd=amount_usd,
        usd_try_rate=rate,
        note=f"Deposited ${amount_usd:.2f} USD",
        transaction_date=tx_date,
    )
    db.add(tx)

    portfolio.total_deposited_usd += amount_usd
    portfolio.total_deposited_try += amount_try
    portfolio.cash_usd += amount_usd
    portfolio.updated_at = datetime.utcnow()

    db.commit()
    return {
        "status": "ok",
        "deposited_usd": amount_usd,
        "deposited_try": amount_try,
        "rate": rate,
        "cash_usd": round(portfolio.cash_usd, 4),
        "cash_try": round(portfolio.cash_try, 2),
    }


def withdraw(db: Session, username: str, amount_usd: float, transaction_date: Optional[str] = None) -> Dict:
    """Withdraw USD from cash balance."""
    portfolio = get_or_create_portfolio(db, username)
    if portfolio.cash_usd < amount_usd:
        return {"error": "Insufficient USD cash balance"}

    rate = get_usd_try_rate()
    amount_try = round(amount_usd * rate, 2)

    # Parse transaction_date if provided
    tx_date = None
    if transaction_date:
        try:
            tx_date = datetime.fromisoformat(transaction_date.replace('Z', '+00:00'))
        except:
            pass

    tx = Transaction(
        portfolio_id=portfolio.id,
        tx_type="withdraw",
        amount_try=amount_try,
        amount_usd=amount_usd,
        usd_try_rate=rate,
        transaction_date=tx_date,
    )
    db.add(tx)

    portfolio.cash_usd -= amount_usd
    portfolio.updated_at = datetime.utcnow()
    db.commit()

    return {
        "status": "ok",
        "withdrawn_usd": amount_usd,
        "withdrawn_try": amount_try,
        "cash_usd": round(portfolio.cash_usd, 4),
        "cash_try": round(portfolio.cash_try, 2),
    }


def withdraw_try(db: Session, username: str, amount_try: float, transaction_date: Optional[str] = None) -> Dict:
    """Withdraw TRY from cash balance."""
    portfolio = get_or_create_portfolio(db, username)
    if portfolio.cash_try < amount_try:
        return {"error": "Insufficient TRY cash balance"}

    rate = get_usd_try_rate()
    amount_usd = round(amount_try / rate, 4)

    # Parse transaction_date if provided
    tx_date = None
    if transaction_date:
        try:
            tx_date = datetime.fromisoformat(transaction_date.replace('Z', '+00:00'))
        except:
            pass

    tx = Transaction(
        portfolio_id=portfolio.id,
        tx_type="withdraw",
        amount_try=amount_try,
        amount_usd=amount_usd,
        usd_try_rate=rate,
        note=f"Withdrew {amount_try:.2f} TRY",
        transaction_date=tx_date,
    )
    db.add(tx)

    portfolio.cash_try -= amount_try
    portfolio.updated_at = datetime.utcnow()
    db.commit()

    return {
        "status": "ok",
        "withdrawn_try": amount_try,
        "withdrawn_usd": amount_usd,
        "cash_try": round(portfolio.cash_try, 2),
        "cash_usd": round(portfolio.cash_usd, 4),
    }


def exchange_currency(
    db: Session, 
    username: str, 
    amount_try: float, 
    rate: float,
    direction: str,
    transaction_date: Optional[str] = None
) -> Dict:
    """
    Exchange between TRY and USD. User specifies TRY amount and exchange rate.
    direction: 'buy_usd' (TRY→USD) or 'sell_usd' (USD→TRY)
    USD amount is calculated as amount_try / rate.
    """
    portfolio = get_or_create_portfolio(db, username)
    
    if rate <= 0 or amount_try <= 0:
        return {"error": "TRY amount and rate must be positive"}
    
    # Calculate USD from TRY and rate
    rate_used = round(rate, 4)
    amount_usd = round(amount_try / rate, 4)
    
    # Parse transaction_date if provided
    tx_date = None
    if transaction_date:
        try:
            tx_date = datetime.fromisoformat(transaction_date.replace('Z', '+00:00'))
        except:
            pass

    if direction == 'buy_usd':
        # User gives TRY to buy USD
        if portfolio.cash_try < amount_try:
            return {"error": f"Insufficient TRY. Have ₺{portfolio.cash_try:.2f}"}
        
        portfolio.cash_try -= amount_try
        portfolio.cash_usd += amount_usd

        tx = Transaction(
            portfolio_id=portfolio.id,
            tx_type="exchange",
            amount_try=amount_try,
            amount_usd=amount_usd,
            usd_try_rate=rate_used,
            note=f"Bought ${amount_usd:.4f} USD with ₺{amount_try:.2f} TRY at {rate_used:.4f}",
            transaction_date=tx_date,
        )
        db.add(tx)
        db.commit()
        
        return {
            "status": "ok",
            "direction": "buy_usd",
            "try_spent": amount_try,
            "usd_received": amount_usd,
            "rate_used": rate_used,
            "cash_try": round(portfolio.cash_try, 2),
            "cash_usd": round(portfolio.cash_usd, 4),
        }
    else:  # sell_usd → convert USD→TRY
        if portfolio.cash_usd < amount_usd:
            return {"error": f"Insufficient USD. Have ${portfolio.cash_usd:.4f}"}

        portfolio.cash_usd -= amount_usd
        portfolio.cash_try += amount_try

        tx = Transaction(
            portfolio_id=portfolio.id,
            tx_type="exchange",
            amount_try=amount_try,
            amount_usd=amount_usd,
            usd_try_rate=rate_used,
            note=f"Sold ${amount_usd:.4f} USD for ₺{amount_try:.2f} TRY at {rate_used:.4f}",
            transaction_date=tx_date,
        )
        db.add(tx)
        db.commit()
        
        return {
            "status": "ok",
            "direction": "sell_usd",
            "usd_spent": amount_usd,
            "try_received": amount_try,
            "rate_used": rate_used,
            "cash_try": round(portfolio.cash_try, 2),
            "cash_usd": round(portfolio.cash_usd, 4),
        }


def buy_asset(
    db: Session, 
    username: str, 
    symbol: str, 
    quantity: Optional[float] = None, 
    amount_usd: Optional[float] = None,
    transaction_date: Optional[str] = None,
    custom_price: Optional[float] = None
) -> Dict:
    """Buy an asset. Specify either quantity or amount_usd. Optionally provide custom_price."""
    portfolio = get_or_create_portfolio(db, username)
    
    # Use custom price if provided, otherwise fetch live price
    if custom_price:
        price_usd = custom_price
    else:
        price_data = get_live_price(symbol)
        if "error" in price_data:
            return price_data

        price = price_data["price"]
        # If BIST stock, convert TRY price to USD
        if symbol.endswith(".IS"):
            rate = get_usd_try_rate()
            price_usd = round(price / rate, 4)
        else:
            price_usd = price

    # Calculate quantity if amount_usd is provided
    if not quantity and amount_usd:
        quantity = round(amount_usd / price_usd, 4)
    elif not quantity:
        return {"error": "Either quantity or amount_usd must be specified"}

    total_cost = round(price_usd * quantity, 4)
    if portfolio.cash_usd < total_cost:
        return {"error": f"Insufficient cash. Need ${total_cost:.2f}, have ${portfolio.cash_usd:.2f}"}

    rate = get_usd_try_rate()
    
    # Parse transaction_date if provided
    tx_date = None
    if transaction_date:
        try:
            tx_date = datetime.fromisoformat(transaction_date.replace('Z', '+00:00'))
        except:
            pass

    tx = Transaction(
        portfolio_id=portfolio.id,
        tx_type="buy",
        symbol=symbol,
        quantity=quantity,
        amount_usd=total_cost,
        amount_try=round(total_cost * rate, 2),
        usd_try_rate=rate,
        note=f"Bought {quantity} {symbol} at ${price_usd:.4f}",
        transaction_date=tx_date,
    )
    db.add(tx)

    # Update holding
    holding = db.query(Holding).filter(
        Holding.portfolio_id == portfolio.id,
        Holding.symbol == symbol,
    ).first()

    if holding:
        # Average cost basis
        total_qty = holding.quantity + quantity
        holding.avg_cost_usd = round(
            (holding.avg_cost_usd * holding.quantity + price_usd * quantity) / total_qty, 4
        )
        holding.quantity = total_qty
        holding.updated_at = datetime.utcnow()
    else:
        holding = Holding(
            portfolio_id=portfolio.id,
            symbol=symbol,
            quantity=quantity,
            avg_cost_usd=price_usd,
        )
        db.add(holding)

    portfolio.cash_usd -= total_cost
    portfolio.updated_at = datetime.utcnow()
    db.commit()

    return {
        "status": "ok",
        "symbol": symbol,
        "quantity": quantity,
        "price_usd": price_usd,
        "total_cost_usd": total_cost,
        "cash_usd": round(portfolio.cash_usd, 4),
    }


def sell_asset(
    db: Session, 
    username: str, 
    symbol: str, 
    quantity: Optional[float] = None,
    amount_usd: Optional[float] = None,
    transaction_date: Optional[str] = None,
    custom_price: Optional[float] = None
) -> Dict:
    """Sell an asset. Specify either quantity or amount_usd. Optionally provide custom_price."""
    portfolio = get_or_create_portfolio(db, username)

    holding = db.query(Holding).filter(
        Holding.portfolio_id == portfolio.id,
        Holding.symbol == symbol,
    ).first()
    
    # Use custom price if provided, otherwise fetch live price
    if custom_price:
        price_usd = custom_price
    else:
        price_data = get_live_price(symbol)
        if "error" in price_data:
            return price_data

        price = price_data["price"]
        if symbol.endswith(".IS"):
            rate = get_usd_try_rate()
            price_usd = round(price / rate, 4)
        else:
            price_usd = price

    # Calculate quantity if amount_usd is provided
    if not quantity and amount_usd:
        quantity = round(amount_usd / price_usd, 4)
    elif not quantity:
        return {"error": "Either quantity or amount_usd must be specified"}

    if not holding or holding.quantity < quantity:
        avail = holding.quantity if holding else 0
        return {"error": f"Insufficient holdings. Have {avail}, trying to sell {quantity}"}

    total_value = round(price_usd * quantity, 4)
    rate = get_usd_try_rate()

    # Parse transaction_date if provided
    tx_date = None
    if transaction_date:
        try:
            tx_date = datetime.fromisoformat(transaction_date.replace('Z', '+00:00'))
        except:
            pass

    tx = Transaction(
        portfolio_id=portfolio.id,
        tx_type="sell",
        symbol=symbol,
        quantity=quantity,
        amount_usd=total_value,
        amount_try=round(total_value * rate, 2),
        usd_try_rate=rate,
        note=f"Sold {quantity} {symbol} at ${price_usd:.4f}",
        transaction_date=tx_date,
    )
    db.add(tx)

    holding.quantity -= quantity
    if holding.quantity <= 0.0001:  # effectively zero
        db.delete(holding)

    portfolio.cash_usd += total_value
    portfolio.updated_at = datetime.utcnow()
    db.commit()

    pnl = round((price_usd - holding.avg_cost_usd) * quantity, 4) if holding else 0

    return {
        "status": "ok",
        "symbol": symbol,
        "quantity": quantity,
        "price_usd": price_usd,
        "total_value_usd": total_value,
        "realized_pnl_usd": pnl,
        "cash_usd": round(portfolio.cash_usd, 4),
    }


def interest_in(
    db: Session, 
    username: str, 
    amount_usd: float,
    annual_rate: float, 
    start_date: str,
    end_date: str,
    payment_interval: str = 'end'
) -> Dict:
    """
    Move USD cash into an interest-bearing deposit.
    annual_rate in percentage (e.g. 45 for 45%).
    start_date, end_date: ISO format date strings
    payment_interval: 'daily', 'weekly', 'monthly', or 'end' (default: at end date)
    """
    portfolio = get_or_create_portfolio(db, username)
    if portfolio.cash_usd < amount_usd:
        return {"error": "Insufficient USD cash balance"}

    # Parse dates
    try:
        start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
    except:
        return {"error": "Invalid date format. Use ISO format (YYYY-MM-DD)"}
    
    if end_dt <= start_dt:
        return {"error": "End date must be after start date"}
    
    days = (end_dt - start_dt).days
    earned = round(amount_usd * (annual_rate / 100) * (days / 365), 4)
    rate = get_usd_try_rate()

    tx = Transaction(
        portfolio_id=portfolio.id,
        tx_type="interest_in",
        amount_usd=amount_usd,
        amount_try=round(amount_usd * rate, 2),
        usd_try_rate=rate,
        interest_rate=annual_rate,
        interest_days=days,
        interest_start_date=start_dt,
        interest_end_date=end_dt,
        interest_payment_interval=payment_interval,
        interest_earned_usd=earned,
        note=f"USD Interest deposit: ${amount_usd:.2f} at {annual_rate}% from {start_date} to {end_date} ({days} days, {payment_interval} payments) → earned ${earned:.4f}",
        transaction_date=start_dt,
    )
    db.add(tx)

    portfolio.cash_usd -= amount_usd
    portfolio.interest_balance_usd += amount_usd
    portfolio.updated_at = datetime.utcnow()
    db.commit()

    return {
        "status": "ok",
        "currency": "USD",
        "deposited_usd": amount_usd,
        "annual_rate": annual_rate,
        "start_date": start_date,
        "end_date": end_date,
        "days": days,
        "payment_interval": payment_interval,
        "interest_earned_usd": earned,
    }


def interest_in_try(
    db: Session, 
    username: str, 
    amount_try: float,
    annual_rate: float, 
    start_date: str,
    end_date: str,
    payment_interval: str = 'end'
) -> Dict:
    """
    Move TRY cash into an interest-bearing deposit.
    annual_rate in percentage (e.g. 45 for 45%).
    start_date, end_date: ISO format date strings
    payment_interval: 'daily', 'weekly', 'monthly', or 'end' (default: at end date)
    """
    portfolio = get_or_create_portfolio(db, username)
    if portfolio.cash_try < amount_try:
        return {"error": "Insufficient TRY cash balance"}

    # Parse dates
    try:
        start_dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        end_dt = datetime.fromisoformat(end_date.replace('Z', '+00:00'))
    except:
        return {"error": "Invalid date format. Use ISO format (YYYY-MM-DD)"}
    
    if end_dt <= start_dt:
        return {"error": "End date must be after start date"}
    
    days = (end_dt - start_dt).days
    earned = round(amount_try * (annual_rate / 100) * (days / 365), 2)
    rate = get_usd_try_rate()

    tx = Transaction(
        portfolio_id=portfolio.id,
        tx_type="interest_in",
        amount_try=amount_try,
        amount_usd=round(amount_try / rate, 4),
        usd_try_rate=rate,
        interest_rate=annual_rate,
        interest_days=days,
        interest_start_date=start_dt,
        interest_end_date=end_dt,
        interest_payment_interval=payment_interval,
        interest_earned_try=earned,
        note=f"TRY Interest deposit: ₺{amount_try:.2f} at {annual_rate}% from {start_date} to {end_date} ({days} days, {payment_interval} payments) → earned ₺{earned:.2f}",
        transaction_date=start_dt,
    )
    db.add(tx)

    portfolio.cash_try -= amount_try
    portfolio.interest_balance_try += amount_try
    portfolio.updated_at = datetime.utcnow()
    db.commit()

    return {
        "status": "ok",
        "currency": "TRY",
        "deposited_try": amount_try,
        "annual_rate": annual_rate,
        "days": days,
        "interest_earned_try": earned,
    }


def interest_out(db: Session, username: str, amount_usd: float,
                 earned_usd: float) -> Dict:
    """
    Withdraw from USD interest deposit back to cash (principal + interest earned).
    """
    portfolio = get_or_create_portfolio(db, username)
    if portfolio.interest_balance_usd < amount_usd:
        return {"error": "Insufficient USD interest balance"}

    rate = get_usd_try_rate()
    total_back = amount_usd + earned_usd

    tx = Transaction(
        portfolio_id=portfolio.id,
        tx_type="interest_out",
        amount_usd=total_back,
        amount_try=round(total_back * rate, 2),
        usd_try_rate=rate,
        interest_earned_usd=earned_usd,
        note=f"USD Interest withdrawal: ${amount_usd:.2f} + ${earned_usd:.4f} interest",
    )
    db.add(tx)

    portfolio.interest_balance_usd -= amount_usd
    portfolio.cash_usd += total_back
    portfolio.updated_at = datetime.utcnow()
    db.commit()

    return {
        "status": "ok",
        "currency": "USD",
        "principal_usd": amount_usd,
        "interest_earned_usd": earned_usd,
        "total_returned_usd": total_back,
        "cash_usd": round(portfolio.cash_usd, 4),
    }


def interest_out_try(db: Session, username: str, amount_try: float,
                     earned_try: float) -> Dict:
    """Withdraw from TRY interest deposit back to cash."""
    portfolio = get_or_create_portfolio(db, username)
    if portfolio.interest_balance_try < amount_try:
        return {"error": "Insufficient TRY interest balance"}

    rate = get_usd_try_rate()
    total_back = amount_try + earned_try

    tx = Transaction(
        portfolio_id=portfolio.id,
        tx_type="interest_out",
        amount_try=total_back,
        amount_usd=round(total_back / rate, 4),
        usd_try_rate=rate,
        interest_earned_try=earned_try,
        note=f"TRY Interest withdrawal: ₺{amount_try:.2f} + ₺{earned_try:.2f} interest",
    )
    db.add(tx)

    portfolio.interest_balance_try -= amount_try
    portfolio.cash_try += total_back
    portfolio.updated_at = datetime.utcnow()
    db.commit()

    return {
        "status": "ok",
        "currency": "TRY",
        "principal_try": amount_try,
        "interest_earned_try": earned_try,
        "total_returned_try": total_back,
        "cash_try": round(portfolio.cash_try, 2),
    }


def get_portfolio_summary(db: Session, username: str) -> Dict:
    """
    Full portfolio summary including:
    - Current balances (USD + TRY)
    - Holdings with current market value
    - P&L (nominal and inflation-adjusted)
    - Quarterly and annual returns
    """
    portfolio = get_or_create_portfolio(db, username)
    rate = get_usd_try_rate()

    # Holdings and their current values
    holdings = db.query(Holding).filter(Holding.portfolio_id == portfolio.id).all()
    holdings_data: List[Dict] = []
    total_holdings_value_usd = 0.0

    for h in holdings:
        price_data = get_live_price(h.symbol)
        if "error" in price_data:
            current_price = h.avg_cost_usd  # fallback
        else:
            price = price_data["price"]
            if h.symbol.endswith(".IS"):
                current_price = round(price / rate, 4)
            else:
                current_price = price

        market_value = round(current_price * h.quantity, 4)
        cost_basis = round(h.avg_cost_usd * h.quantity, 4)
        pnl = round(market_value - cost_basis, 4)
        pnl_pct = round((pnl / cost_basis) * 100, 2) if cost_basis > 0 else 0

        total_holdings_value_usd += market_value
        holdings_data.append({
            "symbol": h.symbol,
            "quantity": h.quantity,
            "avg_cost_usd": h.avg_cost_usd,
            "current_price_usd": current_price,
            "market_value_usd": market_value,
            "unrealized_pnl_usd": pnl,
            "unrealized_pnl_pct": pnl_pct,
        })

    # Total portfolio value (USD-based: convert TRY balances to USD)
    total_value_usd = (
        portfolio.cash_usd + portfolio.interest_balance_usd +
        total_holdings_value_usd +
        (portfolio.cash_try / rate if rate > 0 else 0) +
        (portfolio.interest_balance_try / rate if rate > 0 else 0)
    )
    total_value_try = round(total_value_usd * rate, 2)

    # Nominal P&L
    nominal_pnl_usd = round(total_value_usd - portfolio.total_deposited_usd, 4)
    nominal_pnl_pct = round(
        (nominal_pnl_usd / portfolio.total_deposited_usd) * 100, 2
    ) if portfolio.total_deposited_usd > 0 else 0

    # Inflation-adjusted P&L
    first_tx = db.query(Transaction).filter(
        Transaction.portfolio_id == portfolio.id,
        Transaction.tx_type == "deposit",
    ).order_by(Transaction.created_at.asc()).first()

    inflation_factor = 1.0
    inflation_adjusted_pnl_usd = nominal_pnl_usd
    inflation_method = "No deposits yet"

    if first_tx:
        from_date = first_tx.created_at
        to_date = datetime.utcnow()
        inflation_factor = _get_inflation_factor(from_date, to_date)

        deposits = db.query(Transaction).filter(
            Transaction.portfolio_id == portfolio.id,
            Transaction.tx_type == "deposit",
        ).all()

        inflation_adjusted_deposits = round(portfolio.total_deposited_usd * inflation_factor, 4)
        inflation_adjusted_pnl_usd = round(total_value_usd - portfolio.total_deposited_usd, 4)
        real_pnl_usd = round(total_value_usd - (portfolio.total_deposited_usd / inflation_factor), 4)

        inflation_method = (
            "Uses BLS CPI-U quarterly data. For partial quarters, applies "
            "(1 + quarterly_inflation)^(days_elapsed/total_quarter_days). "
            "Unpublished current quarter uses Cleveland Fed expectations or trailing 4Q average."
        )

    expected_cpi = _fetch_expected_cpi()

    # Bank FX rates
    bank_rates = get_bank_fx_rates()

    # Quarterly & annual returns
    periodic_returns = _compute_periodic_returns(db, portfolio, rate)

    return {
        "username": username,
        "cash_usd": round(portfolio.cash_usd, 4),
        "cash_try": round(portfolio.cash_try, 2),
        "interest_balance_usd": round(portfolio.interest_balance_usd, 4),
        "interest_balance_try": round(portfolio.interest_balance_try, 2),
        "holdings_value_usd": round(total_holdings_value_usd, 4),
        "holdings_value_try": round(total_holdings_value_usd * rate, 2),
        "total_value_usd": round(total_value_usd, 4),
        "total_value_try": total_value_try,
        "total_deposited_usd": round(portfolio.total_deposited_usd, 4),
        "total_deposited_try": round(portfolio.total_deposited_try, 2),
        "usd_try_rate": rate,
        "nominal_pnl_usd": nominal_pnl_usd,
        "nominal_pnl_try": round(nominal_pnl_usd * rate, 2),
        "nominal_pnl_pct": nominal_pnl_pct,
        "inflation_factor": round(inflation_factor, 6),
        "inflation_adjusted_pnl_usd": round(inflation_adjusted_pnl_usd, 4),
        "expected_cpi": expected_cpi,
        "inflation_method": inflation_method,
        "holdings": holdings_data,
        "bank_rates": bank_rates,
        "periodic_returns": periodic_returns,
    }


def _compute_periodic_returns(db: Session, portfolio: Portfolio, rate: float) -> Dict:
    """Compute quarterly and annual returns from first deposit date."""
    first_tx = db.query(Transaction).filter(
        Transaction.portfolio_id == portfolio.id,
        Transaction.tx_type == "deposit",
    ).order_by(Transaction.created_at.asc()).first()

    if not first_tx:
        return {"quarterly": [], "annual": [], "since_inception": None}

    start_date = first_tx.created_at
    now = datetime.utcnow()
    total_days = (now - start_date).days
    if total_days <= 0:
        return {"quarterly": [], "annual": [], "since_inception": None}

    # Current total value
    holdings = db.query(Holding).filter(Holding.portfolio_id == portfolio.id).all()
    total_holdings_usd = 0.0
    for h in holdings:
        pd = get_live_price(h.symbol)
        if "error" not in pd:
            p = pd["price"]
            if h.symbol.endswith(".IS"):
                p = p / rate if rate > 0 else p
            total_holdings_usd += p * h.quantity
        else:
            total_holdings_usd += h.avg_cost_usd * h.quantity

    total_value_usd = (
        portfolio.cash_usd + portfolio.interest_balance_usd +
        total_holdings_usd +
        (portfolio.cash_try / rate if rate > 0 else 0) +
        (portfolio.interest_balance_try / rate if rate > 0 else 0)
    )

    dep_usd = portfolio.total_deposited_usd if portfolio.total_deposited_usd > 0 else 1
    pnl_usd = total_value_usd - dep_usd
    pnl_pct = (pnl_usd / dep_usd) * 100

    # Since inception
    since_inception = {
        "days": total_days,
        "pnl_usd": round(pnl_usd, 2),
        "pnl_try": round(pnl_usd * rate, 2),
        "pnl_pct": round(pnl_pct, 2),
        "start_date": start_date.isoformat(),
    }

    # Annualized
    annual_pct = ((1 + pnl_pct / 100) ** (365 / total_days) - 1) * 100 if total_days > 0 else 0

    # Quarterly return (simple: pnl / (days/90))
    quarters_elapsed = max(total_days / 90, 1)
    quarterly_pct = pnl_pct / quarters_elapsed

    quarterly = [{
        "period": f"Q avg ({quarters_elapsed:.1f} quarters)",
        "pnl_pct": round(quarterly_pct, 2),
        "pnl_usd": round(pnl_usd / quarters_elapsed, 2),
        "pnl_try": round((pnl_usd / quarters_elapsed) * rate, 2),
    }]

    annual = [{
        "period": "Annualized",
        "pnl_pct": round(annual_pct, 2),
        "pnl_usd": round(pnl_usd * (365 / total_days) if total_days > 0 else 0, 2),
        "pnl_try": round(pnl_usd * (365 / total_days) * rate if total_days > 0 else 0, 2),
    }]

    return {
        "quarterly": quarterly,
        "annual": annual,
        "since_inception": since_inception,
    }


def validate_transaction_timeline(db: Session, portfolio_id: int, exclude_tx_id: Optional[int] = None) -> Dict:
    """
    Validates complete transaction timeline to ensure balances never go negative.
    Used when deleting a transaction to check if removal would break the timeline.
    
    Args:
        db: Database session
        portfolio_id: Portfolio ID to validate
        exclude_tx_id: Transaction ID to exclude from timeline (for delete simulation)
    
    Returns:
        Dict with "valid": bool and "error": str if invalid
    """
    # Get all transactions in chronological order
    query = db.query(Transaction).filter(Transaction.portfolio_id == portfolio_id)
    if exclude_tx_id:
        query = query.filter(Transaction.id != exclude_tx_id)
    
    txs = query.order_by(
        case((Transaction.transaction_date.is_(None), 1), else_=0),
        Transaction.transaction_date.asc(),
        Transaction.created_at.asc()
    ).all()
    
    # Simulate timeline
    cash_usd = 0.0
    cash_try = 0.0
    interest_usd = 0.0
    interest_try = 0.0
    holdings: Dict[str, float] = {}  # symbol → quantity
    
    for tx in txs:
        tx_date = tx.transaction_date or tx.created_at
        
        if tx.tx_type == "deposit":
            cash_usd += tx.amount_usd or 0
            cash_try += tx.amount_try or 0
            
        elif tx.tx_type == "withdraw":
            if tx.amount_usd and cash_usd < tx.amount_usd:
                return {
                    "valid": False,
                    "error": f"Insufficient USD cash at {tx_date.isoformat()}: need ${tx.amount_usd}, have ${cash_usd:.2f}"
                }
            if tx.amount_try and cash_try < tx.amount_try:
                return {
                    "valid": False,
                    "error": f"Insufficient TRY cash at {tx_date.isoformat()}: need ₺{tx.amount_try}, have ₺{cash_try:.2f}"
                }
            cash_usd -= tx.amount_usd or 0
            cash_try -= tx.amount_try or 0
            
        elif tx.tx_type == "buy":
            cost = tx.amount_usd or 0
            if cash_usd < cost:
                return {
                    "valid": False,
                    "error": f"Insufficient USD to buy {tx.symbol} at {tx_date.isoformat()}: need ${cost}, have ${cash_usd:.2f}"
                }
            cash_usd -= cost
            holdings[tx.symbol] = holdings.get(tx.symbol, 0) + (tx.quantity or 0)
            
        elif tx.tx_type == "sell":
            current_holding = holdings.get(tx.symbol, 0)
            if current_holding < (tx.quantity or 0):
                return {
                    "valid": False,
                    "error": f"Insufficient holdings to sell {tx.symbol} at {tx_date.isoformat()}: need {tx.quantity}, have {current_holding}"
                }
            holdings[tx.symbol] = current_holding - (tx.quantity or 0)
            cash_usd += tx.amount_usd or 0
            
        elif tx.tx_type == "interest_in":
            if tx.amount_usd:
                if cash_usd < tx.amount_usd:
                    return {
                        "valid": False,
                        "error": f"Insufficient USD cash for interest deposit at {tx_date.isoformat()}: need ${tx.amount_usd}, have ${cash_usd:.2f}"
                    }
                cash_usd -= tx.amount_usd
                interest_usd += tx.amount_usd
            if tx.amount_try:
                if cash_try < tx.amount_try:
                    return {
                        "valid": False,
                        "error": f"Insufficient TRY cash for interest deposit at {tx_date.isoformat()}: need ₺{tx.amount_try}, have ₺{cash_try:.2f}"
                    }
                cash_try -= tx.amount_try
                interest_try += tx.amount_try
                
        elif tx.tx_type == "interest_out":
            principal_usd = (tx.amount_usd or 0) - (tx.interest_earned_usd or 0)
            principal_try = (tx.amount_try or 0) - (tx.interest_earned_try or 0)
            
            if principal_usd > 0:
                if interest_usd < principal_usd:
                    return {
                        "valid": False,
                        "error": f"Insufficient USD interest balance at {tx_date.isoformat()}: need ${principal_usd}, have ${interest_usd:.2f}"
                    }
                interest_usd -= principal_usd
                cash_usd += tx.amount_usd or 0
                
            if principal_try > 0:
                if interest_try < principal_try:
                    return {
                        "valid": False,
                        "error": f"Insufficient TRY interest balance at {tx_date.isoformat()}: need ₺{principal_try}, have ₺{interest_try:.2f}"
                    }
                interest_try -= principal_try
                cash_try += tx.amount_try or 0
                
        elif tx.tx_type == "exchange":
            # Exchange transactions require validation
            # Determine direction from note or amount flow
            # If we're buying USD, we spend TRY and receive USD
            # Note pattern: "Bought $X USD with ₺Y TRY" or "Sold $X USD for ₺Y TRY"
            note = tx.note or ""
            if "Bought" in note or "buy" in note.lower():
                # Buying USD: spend TRY, receive USD
                if cash_try < (tx.amount_try or 0):
                    return {
                        "valid": False,
                        "error": f"Insufficient TRY for exchange at {tx_date.isoformat()}: need ₺{tx.amount_try}, have ₺{cash_try:.2f}"
                    }
                cash_try -= tx.amount_try or 0
                cash_usd += tx.amount_usd or 0
            else:
                # Selling USD: spend USD, receive TRY
                if cash_usd < (tx.amount_usd or 0):
                    return {
                        "valid": False,
                        "error": f"Insufficient USD for exchange at {tx_date.isoformat()}: need ${tx.amount_usd}, have ${cash_usd:.2f}"
                    }
                cash_usd -= tx.amount_usd or 0
                cash_try += tx.amount_try or 0
    
    return {"valid": True}


def delete_transaction(db: Session, username: str, tx_id: int) -> Dict:
    """
    Delete a transaction and recalculate portfolio balances.
    
    Args:
        db: Database session
        username: Username
        tx_id: Transaction ID to delete
    
    Returns:
        Dict with "status": "ok" or "error": str
    """
    portfolio = get_or_create_portfolio(db, username)
    
    # Check if transaction exists and belongs to this user
    tx = db.query(Transaction).filter(
        Transaction.id == tx_id,
        Transaction.portfolio_id == portfolio.id
    ).first()
    
    if not tx:
        return {"error": "Transaction not found or access denied"}
    
    # Delete the transaction
    db.delete(tx)
    db.flush()
    
    # Recalculate portfolio balances from scratch
    _recalculate_portfolio_balances(db, portfolio)
    
    db.commit()
    
    return {"status": "ok", "message": "Transaction deleted successfully"}


def _recalculate_portfolio_balances(db: Session, portfolio: Portfolio):
    """
    Recalculate all portfolio balances from transaction history.
    Called after deleting a transaction.
    """
    # Reset balances
    portfolio.cash_usd = 0.0
    portfolio.cash_try = 0.0
    portfolio.interest_balance_usd = 0.0
    portfolio.interest_balance_try = 0.0
    portfolio.total_deposited_usd = 0.0
    portfolio.total_deposited_try = 0.0
    
    # Delete all holdings
    db.query(Holding).filter(Holding.portfolio_id == portfolio.id).delete()
    
    # Replay all transactions
    txs = db.query(Transaction).filter(
        Transaction.portfolio_id == portfolio.id
    ).order_by(
        case((Transaction.transaction_date.is_(None), 1), else_=0),
        Transaction.transaction_date.asc(),
        Transaction.created_at.asc()
    ).all()
    
    holdings: Dict[str, dict] = {}  # symbol → {quantity, total_cost}
    
    for tx in txs:
        if tx.tx_type == "deposit":
            portfolio.cash_usd += tx.amount_usd or 0
            portfolio.cash_try += tx.amount_try or 0
            portfolio.total_deposited_usd += tx.amount_usd or 0
            portfolio.total_deposited_try += tx.amount_try or 0
            
        elif tx.tx_type == "withdraw":
            portfolio.cash_usd -= tx.amount_usd or 0
            portfolio.cash_try -= tx.amount_try or 0
            
        elif tx.tx_type == "buy":
            portfolio.cash_usd -= tx.amount_usd or 0
            if tx.symbol not in holdings:
                holdings[tx.symbol] = {"quantity": 0, "total_cost": 0}
            holdings[tx.symbol]["quantity"] += tx.quantity or 0
            holdings[tx.symbol]["total_cost"] += tx.amount_usd or 0
            
        elif tx.tx_type == "sell":
            if tx.symbol in holdings:
                holdings[tx.symbol]["quantity"] -= tx.quantity or 0
                # Proportionally reduce cost basis
                if holdings[tx.symbol]["quantity"] > 0:
                    cost_reduction = (tx.quantity or 0) / (holdings[tx.symbol]["quantity"] + (tx.quantity or 0)) * holdings[tx.symbol]["total_cost"]
                    holdings[tx.symbol]["total_cost"] -= cost_reduction
                else:
                    holdings[tx.symbol]["total_cost"] = 0
            portfolio.cash_usd += tx.amount_usd or 0
            
        elif tx.tx_type == "interest_in":
            if tx.amount_usd:
                portfolio.cash_usd -= tx.amount_usd
                portfolio.interest_balance_usd += tx.amount_usd
            if tx.amount_try:
                portfolio.cash_try -= tx.amount_try
                portfolio.interest_balance_try += tx.amount_try
                
        elif tx.tx_type == "interest_out":
            principal_usd = (tx.amount_usd or 0) - (tx.interest_earned_usd or 0)
            principal_try = (tx.amount_try or 0) - (tx.interest_earned_try or 0)
            if principal_usd > 0:
                portfolio.interest_balance_usd -= principal_usd
                portfolio.cash_usd += tx.amount_usd or 0
            if principal_try > 0:
                portfolio.interest_balance_try -= principal_try
                portfolio.cash_try += tx.amount_try or 0
                
        elif tx.tx_type == "exchange":
            # Exchange transactions
            note = tx.note or ""
            if "Bought" in note or "buy" in note.lower():
                # Buying USD: spend TRY, receive USD
                portfolio.cash_try -= tx.amount_try or 0
                portfolio.cash_usd += tx.amount_usd or 0
            else:
                # Selling USD: spend USD, receive TRY
                portfolio.cash_usd -= tx.amount_usd or 0
                portfolio.cash_try += tx.amount_try or 0
    
    # Recreate holdings
    for symbol, data in holdings.items():
        if data["quantity"] > 0.0001:
            holding = Holding(
                portfolio_id=portfolio.id,
                symbol=symbol,
                quantity=data["quantity"],
                avg_cost_usd=data["total_cost"] / data["quantity"] if data["quantity"] > 0 else 0
            )
            db.add(holding)
    
    portfolio.updated_at = datetime.utcnow()


def get_transactions(db: Session, username: str, limit: int = 50) -> List[Dict]:
    """Return recent transactions for a user."""
    portfolio = get_or_create_portfolio(db, username)
    txs = db.query(Transaction).filter(
        Transaction.portfolio_id == portfolio.id,
    ).order_by(Transaction.created_at.desc()).limit(limit).all()

    return [{
        "id": tx.id,
        "type": tx.tx_type,
        "symbol": tx.symbol,
        "quantity": tx.quantity,
        "amount_try": tx.amount_try,
        "amount_usd": tx.amount_usd,
        "usd_try_rate": tx.usd_try_rate,
        "interest_rate": tx.interest_rate,
        "interest_days": tx.interest_days,
        "interest_start_date": tx.interest_start_date.isoformat() if getattr(tx, 'interest_start_date', None) else None,
        "interest_end_date": tx.interest_end_date.isoformat() if getattr(tx, 'interest_end_date', None) else None,
        "interest_payment_interval": getattr(tx, 'interest_payment_interval', None),
        "interest_earned_usd": tx.interest_earned_usd,
        "interest_earned_try": getattr(tx, 'interest_earned_try', None),
        "note": tx.note,
        "transaction_date": tx.transaction_date.isoformat() if getattr(tx, 'transaction_date', None) else None,
        "created_at": tx.created_at.isoformat() if tx.created_at else None,
    } for tx in txs]


# ═══════════════════════════════════════════════════════════════
#  ASSUMPTIONS & FORMULAS
# ═══════════════════════════════════════════════════════════════
"""
1. DEPOSIT LOGIC:
   - User deposits TRY. We convert to USD at the CURRENT USD/TRY rate.
   - Example: 400 TRY deposited when rate is 40 TRY/USD → $10 recorded.
   - Example: 500 TRY deposited when rate is 50 TRY/USD → $10 recorded.
   - Total deposited: 900 TRY = $20 USD (at deposit-time rates).

2. P&L CALCULATION (Nominal):
   - P&L = current_portfolio_value_usd − total_deposited_usd
   - current_portfolio_value = cash_usd + interest_balance_usd + sum(holdings × current_price)
   - All holdings valued in USD (BIST stocks converted via live USD/TRY rate).

3. INTEREST CALCULATION:
   - Simple interest: earned = principal × (annual_rate / 100) × (days / 365)
   - User specifies annual rate and number of days.

4. INFLATION-ADJUSTED P&L:
   - Uses US BLS CPI-U quarterly data (Series: CUSR0000SA0).
   - Quarterly inflation = (CPI_current_quarter / CPI_previous_quarter) − 1
   - For partial quarters: factor = (1 + quarterly_inflation) ^ (days_elapsed / total_days_in_quarter)
   - Purchasing power factor compounds across all quarters from first deposit to today.
   - Final quarter (unpublished): Uses Cleveland Fed inflation expectations
     or trailing 4-quarter annualized average, converted to quarterly.
   - Real P&L = current_value − (total_deposited / inflation_factor)
     where inflation_factor < 1 means money lost purchasing power.

5. CURRENCY:
   - All portfolio values stored and calculated in USD.
   - TRY display conversions use live USD/TRY rate.
"""
