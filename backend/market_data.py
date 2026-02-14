"""
Market data service — fetches live OHLCV from Yahoo Finance with
CoinGecko fallback for crypto.  Falls back to mock data when APIs
are unreachable so the app always has something to render.
"""

from typing import List, Dict, Optional
from datetime import datetime, timedelta
import requests
import random
import logging
import os

logger = logging.getLogger(__name__)

# ── Yahoo Finance v8 direct API ──────────────────────────────────
_YF_BASE = "https://query1.finance.yahoo.com/v8/finance/chart"
_YF_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}
_http = requests.Session()
_http.headers.update(_YF_HEADERS)

# ── Asset names ──────────────────────────────────────────────────
ASSET_NAMES: Dict[str, str] = {
    # Crypto
    "BTC-USD": "Bitcoin", "ETH-USD": "Ethereum",
    # Commodities
    "GC=F": "Gold (XAU)", "SI=F": "Silver (XAG)",
    # S&P 500 top-50
    "AAPL": "Apple Inc.", "MSFT": "Microsoft Corporation",
    "GOOGL": "Alphabet Inc.", "AMZN": "Amazon.com Inc.",
    "NVDA": "NVIDIA Corporation", "META": "Meta Platforms Inc.",
    "TSLA": "Tesla Inc.", "BRK-B": "Berkshire Hathaway",
    "UNH": "UnitedHealth Group", "JNJ": "Johnson & Johnson",
    "XOM": "Exxon Mobil Corporation", "V": "Visa Inc.",
    "JPM": "JPMorgan Chase & Co.", "PG": "Procter & Gamble",
    "MA": "Mastercard Inc.", "HD": "The Home Depot",
    "CVX": "Chevron Corporation", "MRK": "Merck & Co.",
    "ABBV": "AbbVie Inc.", "PEP": "PepsiCo Inc.",
    "COST": "Costco Wholesale", "AVGO": "Broadcom Inc.",
    "KO": "The Coca-Cola Company", "ADBE": "Adobe Inc.",
    "TMO": "Thermo Fisher Scientific", "MCD": "McDonald's Corporation",
    "CSCO": "Cisco Systems", "ACN": "Accenture plc",
    "LIN": "Linde plc", "NFLX": "Netflix Inc.",
    "ABT": "Abbott Laboratories", "WMT": "Walmart Inc.",
    "CRM": "Salesforce Inc.", "DHR": "Danaher Corporation",
    "VZ": "Verizon Communications", "NKE": "Nike Inc.",
    "CMCSA": "Comcast Corporation", "TXN": "Texas Instruments",
    "ORCL": "Oracle Corporation", "DIS": "The Walt Disney Company",
    "NEE": "NextEra Energy", "PM": "Philip Morris",
    "UPS": "United Parcel Service", "BMY": "Bristol Myers Squibb",
    "RTX": "RTX Corporation", "INTC": "Intel Corporation",
    "HON": "Honeywell International", "QCOM": "Qualcomm Inc.",
    "AMD": "Advanced Micro Devices", "LOW": "Lowe's Companies",
    # BIST-100 subset
    "ASELS.IS": "Aselsan", "THYAO.IS": "Turkish Airlines",
    "EREGL.IS": "Eregli Demir Celik", "SAHOL.IS": "Sabanci Holding",
    "GARAN.IS": "Garanti BBVA", "ISCTR.IS": "Is Bankasi (C)",
    "AKBNK.IS": "Akbank", "SISE.IS": "Sisecam",
    "KCHOL.IS": "Koc Holding", "YKBNK.IS": "Yapi Kredi",
    "PETKM.IS": "Petkim", "TUPRS.IS": "Tupras",
    "KOZAA.IS": "Koza Altin", "KOZAL.IS": "Koza Anadolu",
    "TAVHL.IS": "TAV Havalimanlari", "TCELL.IS": "Turkcell",
    "ENKAI.IS": "Enka Insaat", "TTKOM.IS": "Turk Telekom",
    "PGSUS.IS": "Pegasus", "SOKM.IS": "Sok Marketler",
    "BIMAS.IS": "BIM", "FROTO.IS": "Ford Otosan",
    "KRDMD.IS": "Kardemir (D)", "TOASO.IS": "Tofas",
    "OYAKC.IS": "Oyak Cimento", "HEKTS.IS": "Hektas",
    "DOHOL.IS": "Dogan Holding", "VESTL.IS": "Vestel",
    "BRYAT.IS": "Borusan Yatirim", "ARCLK.IS": "Arcelik",
    "GUBRF.IS": "Gubre Fabrikalari", "LOGO.IS": "Logo Yazilim",
    "EKGYO.IS": "Emlak Konut GYO", "ODAS.IS": "Odas",
    "MGROS.IS": "Migros", "SODA.IS": "Soda Sanayi",
    "ULKER.IS": "Ulker Biskuvi", "AEFES.IS": "Anadolu Efes",
    "TTRAK.IS": "Turk Traktor", "CCOLA.IS": "Coca-Cola Icecek",
    "OTKAR.IS": "Otokar", "DOAS.IS": "Dogus Otomotiv",
    "GOODY.IS": "Goodyear", "HALKB.IS": "Halkbank",
    "VAKBN.IS": "Vakifbank", "SASA.IS": "Sasa Polyester",
    "EGEEN.IS": "Ege Endustri", "ALARK.IS": "Alarko Holding",
    "CIMSA.IS": "Cimsa", "ANACM.IS": "Anadolu Cam",
}

# ── Symbol groups ────────────────────────────────────────────────
CRYPTO_SYMBOLS = ["BTC-USD", "ETH-USD"]
COMMODITY_SYMBOLS = ["GC=F", "SI=F"]

SP500_TOP_50 = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B",
    "UNH", "JNJ", "XOM", "V", "JPM", "PG", "MA", "HD",
    "CVX", "MRK", "ABBV", "PEP", "COST", "AVGO", "KO", "ADBE",
    "TMO", "MCD", "CSCO", "ACN", "LIN", "NFLX", "ABT", "WMT",
    "CRM", "DHR", "VZ", "NKE", "CMCSA", "TXN", "ORCL", "DIS",
    "NEE", "PM", "UPS", "BMY", "RTX", "INTC", "HON", "QCOM",
    "AMD", "LOW",
]

BIST_100 = [
    "ASELS.IS", "THYAO.IS", "EREGL.IS", "SAHOL.IS", "GARAN.IS",
    "ISCTR.IS", "AKBNK.IS", "SISE.IS", "KCHOL.IS", "YKBNK.IS",
    "PETKM.IS", "TUPRS.IS", "KOZAA.IS", "KOZAL.IS", "TAVHL.IS",
    "TCELL.IS", "ENKAI.IS", "TTKOM.IS", "PGSUS.IS", "SOKM.IS",
    "BIMAS.IS", "FROTO.IS", "KRDMD.IS", "TOASO.IS", "OYAKC.IS",
    "HEKTS.IS", "DOHOL.IS", "VESTL.IS", "BRYAT.IS", "ARCLK.IS",
    "GUBRF.IS", "LOGO.IS", "EKGYO.IS", "ODAS.IS", "MGROS.IS",
    "SODA.IS", "ULKER.IS", "AEFES.IS", "TTRAK.IS", "CCOLA.IS",
    "OTKAR.IS", "DOAS.IS", "GOODY.IS", "HALKB.IS", "VAKBN.IS",
    "SASA.IS", "EGEEN.IS", "ALARK.IS", "CIMSA.IS", "ANACM.IS",
]

GROUP_MAP: Dict[str, List[str]] = {
    "crypto": CRYPTO_SYMBOLS,
    "commodities": COMMODITY_SYMBOLS,
    "commodity": COMMODITY_SYMBOLS,   # alias kept for backward compat
    "sp50": SP500_TOP_50,
    "sp500": SP500_TOP_50,            # alias
    "bist100": BIST_100,
}

ALL_SYMBOLS = set(CRYPTO_SYMBOLS + COMMODITY_SYMBOLS + SP500_TOP_50 + BIST_100)

# ── Asset registry for DB seeding ────────────────────────────────
def _build_registry() -> List[Dict]:
    registry: List[Dict] = []
    for sym in CRYPTO_SYMBOLS:
        cg_id = "bitcoin" if "BTC" in sym else "ethereum"
        registry.append({"symbol": sym, "name": ASSET_NAMES.get(sym, sym),
                         "group": "crypto", "yahoo_symbol": sym, "coingecko_id": cg_id})
    for sym in COMMODITY_SYMBOLS:
        registry.append({"symbol": sym, "name": ASSET_NAMES.get(sym, sym),
                         "group": "commodities", "yahoo_symbol": sym})
    for sym in SP500_TOP_50:
        registry.append({"symbol": sym, "name": ASSET_NAMES.get(sym, sym),
                         "group": "sp50", "yahoo_symbol": sym})
    for sym in BIST_100:
        registry.append({"symbol": sym, "name": ASSET_NAMES.get(sym, sym),
                         "group": "bist100", "yahoo_symbol": sym, "base_currency": "TRY"})
    return registry

ASSET_REGISTRY = _build_registry()

# ── Interval helpers ─────────────────────────────────────────────
INTERVAL_TO_YF = {
    "5m": "5m", "15m": "15m", "1h": "1h", "4h": "1h",
    "1d": "1d", "1w": "1wk", "1mo": "1mo",
}

INTERVAL_PERIOD_DEFAULT = {
    "5m": "5d",   "15m": "60d",  "1h": "60d",
    "4h": "60d",  "1d": "6mo",   "1w": "2y", "1mo": "5y",
}

INTERVAL_DELTAS = {
    "5m": timedelta(minutes=5), "15m": timedelta(minutes=15),
    "1h": timedelta(hours=1), "4h": timedelta(hours=4),
    "1d": timedelta(days=1), "1wk": timedelta(weeks=1),
    "1w": timedelta(weeks=1), "1mo": timedelta(days=30),
}

# ── FX cache ─────────────────────────────────────────────────────
_fx_cache: Dict[str, tuple] = {}  # pair → (rate, timestamp)
FX_CACHE_TTL = 300  # seconds


def get_usd_try_rate() -> float:
    """Fetch live USD/TRY exchange rate via v8 API. Cached for 5 min."""
    now = datetime.now().timestamp()
    cached = _fx_cache.get("USDTRY")
    if cached and (now - cached[1]) < FX_CACHE_TTL:
        return cached[0]
    try:
        r = _http.get(f"{_YF_BASE}/USDTRY=X", params={"interval": "1d", "range": "2d"}, timeout=10)
        if r.status_code == 200:
            data = r.json()
            closes = data["chart"]["result"][0]["indicators"]["quote"][0]["close"]
            closes = [c for c in closes if c is not None]
            if closes:
                rate = closes[-1]
                _fx_cache["USDTRY"] = (rate, now)
                return rate
    except Exception as e:
        logger.warning("FX fetch failed: %s", e)
    return _fx_cache.get("USDTRY", (36.5, 0))[0]


# ── Mock data generator (fallback) ──────────────────────────────
# Base prices used ONLY when live fetch fails
BASE_PRICES: Dict[str, float] = {
    "BTC-USD": 95000, "ETH-USD": 3500, "GC=F": 2050, "SI=F": 24,
    "AAPL": 225, "MSFT": 425, "GOOGL": 175, "AMZN": 195, "NVDA": 140,
    "META": 565, "TSLA": 350, "UNH": 520, "JNJ": 160, "XOM": 115,
    "V": 305, "JPM": 235, "PG": 170, "MA": 510, "HD": 380,
    "CVX": 164, "MRK": 98, "ABBV": 190, "PEP": 160, "COST": 880,
    "AVGO": 220, "KO": 62, "ADBE": 490, "TMO": 520, "MCD": 285,
    "CSCO": 58, "ACN": 360, "LIN": 470, "NFLX": 885, "ABT": 120,
    "WMT": 92, "CRM": 295, "DHR": 240, "VZ": 42, "NKE": 76,
    "CMCSA": 38, "TXN": 190, "ORCL": 170, "DIS": 110, "NEE": 68,
    "PM": 125, "UPS": 130, "BMY": 52, "RTX": 125, "INTC": 21,
    "HON": 230, "QCOM": 155, "AMD": 120, "LOW": 260, "BRK-B": 475,
}

BIST_BASE_PRICES: Dict[str, float] = {
    "ASELS.IS": 85, "THYAO.IS": 310, "EREGL.IS": 45, "SAHOL.IS": 95,
    "GARAN.IS": 135, "ISCTR.IS": 12, "AKBNK.IS": 65, "SISE.IS": 48,
    "KCHOL.IS": 180, "YKBNK.IS": 38, "PETKM.IS": 210, "TUPRS.IS": 125,
    "KOZAA.IS": 180, "KOZAL.IS": 200, "TAVHL.IS": 95, "TCELL.IS": 65,
    "ENKAI.IS": 15, "TTKOM.IS": 90, "PGSUS.IS": 280, "SOKM.IS": 85,
    "BIMAS.IS": 155, "FROTO.IS": 310, "KRDMD.IS": 35, "TOASO.IS": 105,
    "OYAKC.IS": 75, "HEKTS.IS": 40, "DOHOL.IS": 28, "VESTL.IS": 42,
    "BRYAT.IS": 95, "ARCLK.IS": 125, "GUBRF.IS": 145, "LOGO.IS": 88,
    "EKGYO.IS": 12, "ODAS.IS": 165, "MGROS.IS": 230, "SODA.IS": 38,
    "ULKER.IS": 170, "AEFES.IS": 215, "TTRAK.IS": 195, "CCOLA.IS": 165,
    "OTKAR.IS": 420, "DOAS.IS": 25, "GOODY.IS": 48, "HALKB.IS": 18,
    "VAKBN.IS": 25, "SASA.IS": 85, "EGEEN.IS": 95, "ALARK.IS": 38,
    "CIMSA.IS": 72, "ANACM.IS": 55,
}


def _generate_mock_candles(base_price: float, num_candles: int = 50,
                           interval: str = "1d") -> List[Dict]:
    delta = INTERVAL_DELTAS.get(interval, timedelta(days=1))
    now = datetime.utcnow()
    t = now - delta * num_candles
    price = base_price
    vol_scale = {
        "5m": 0.002, "15m": 0.004, "1h": 0.008,
        "4h": 0.012, "1d": 0.02, "1w": 0.04, "1wk": 0.04, "1mo": 0.08,
    }
    vol = vol_scale.get(interval, 0.02)
    candles: List[Dict] = []
    for _ in range(num_candles):
        o = price
        c = price * (1 + random.uniform(-vol, vol))
        h = max(o, c) * random.uniform(1.001, 1.015)
        lo = min(o, c) * random.uniform(0.985, 0.999)
        candles.append({
            "time": int(t.timestamp()),
            "open": round(o, 2), "high": round(h, 2),
            "low": round(lo, 2), "close": round(c, 2),
            "volume": int(random.uniform(1_000_000, 10_000_000)),
        })
        price = c
        t += delta
    return candles


# ── Live data fetchers ───────────────────────────────────────────
def _fetch_yahoo_v8(symbol: str, interval: str, period: str) -> Optional[List[Dict]]:
    """Fetch OHLCV directly from Yahoo Finance v8 chart API."""
    yf_interval = INTERVAL_TO_YF.get(interval, "1d")
    try:
        r = _http.get(
            f"{_YF_BASE}/{symbol}",
            params={"interval": yf_interval, "range": period},
            timeout=15,
        )
        if r.status_code != 200:
            return None
        data = r.json()
        result = data.get("chart", {}).get("result")
        if not result:
            return None
        res = result[0]
        timestamps = res.get("timestamp", [])
        quote = res.get("indicators", {}).get("quote", [{}])[0]
        opens = quote.get("open", [])
        highs = quote.get("high", [])
        lows = quote.get("low", [])
        closes = quote.get("close", [])
        volumes = quote.get("volume", [])
        if not timestamps:
            return None
        candles: List[Dict] = []
        for i, ts in enumerate(timestamps):
            o = opens[i] if i < len(opens) else None
            h = highs[i] if i < len(highs) else None
            lo = lows[i] if i < len(lows) else None
            c = closes[i] if i < len(closes) else None
            v = volumes[i] if i < len(volumes) else 0
            if None in (o, h, lo, c):
                continue
            candles.append({
                "time": int(ts),
                "open": round(float(o), 2),
                "high": round(float(h), 2),
                "low": round(float(lo), 2),
                "close": round(float(c), 2),
                "volume": int(v or 0),
            })
        return candles if candles else None
    except Exception as e:
        logger.warning("Yahoo v8 fetch %s failed: %s", symbol, e)
    return None


def _fetch_coingecko(coingecko_id: str, days: int = 30) -> Optional[List[Dict]]:
    """Fetch OHLC from CoinGecko free API. Returns list of candle dicts."""
    try:
        url = f"https://api.coingecko.com/api/v3/coins/{coingecko_id}/ohlc"
        resp = requests.get(url, params={"vs_currency": "usd", "days": days}, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            candles = []
            for row in data:
                candles.append({
                    "time": int(row[0] / 1000),
                    "open": round(row[1], 2), "high": round(row[2], 2),
                    "low": round(row[3], 2), "close": round(row[4], 2),
                    "volume": 0,
                })
            return candles if candles else None
    except Exception as e:
        logger.warning("CoinGecko fetch %s failed: %s", coingecko_id, e)
    return None


# _df_to_candles removed – _fetch_yahoo_v8 returns List[Dict] directly


def _aggregate_4h(candles_1h: List[Dict]) -> List[Dict]:
    """Aggregate 1h candles into 4h candles."""
    result: List[Dict] = []
    for i in range(0, len(candles_1h), 4):
        chunk = candles_1h[i:i + 4]
        if not chunk:
            break
        result.append({
            "time": chunk[0]["time"],
            "open": chunk[0]["open"],
            "high": max(c["high"] for c in chunk),
            "low": min(c["low"] for c in chunk),
            "close": chunk[-1]["close"],
            "volume": sum(c["volume"] for c in chunk),
        })
    return result


# ── Public API ───────────────────────────────────────────────────
class MarketDataService:
    """Central market data facade with provider fallback."""

    def fetch_candles(self, symbol: str, interval: str = "1d",
                      start: Optional[str] = None, end: Optional[str] = None,
                      fiat: str = "USD") -> Dict:
        """
        Fetch OHLCV candles. Tries Yahoo Finance first, then CoinGecko
        for crypto, then falls back to mock data.
        """
        if symbol not in ALL_SYMBOLS:
            return {"error": f"Symbol {symbol} not found"}

        period = INTERVAL_PERIOD_DEFAULT.get(interval, "6mo")
        candles: Optional[List[Dict]] = None
        source = "mock"

        # ── Attempt 1: Yahoo Finance v8 API ────────────────────
        candles = _fetch_yahoo_v8(symbol, interval, period)
        if candles:
            if interval == "4h":
                candles = _aggregate_4h(candles)
            source = "yahoo"

        # ── Attempt 2: CoinGecko (crypto only) ──────────────────
        if candles is None and symbol in CRYPTO_SYMBOLS:
            cg_id = "bitcoin" if "BTC" in symbol else "ethereum"
            days_map = {"5m": 1, "15m": 1, "1h": 7, "4h": 30, "1d": 90, "1w": 365, "1mo": 365}
            candles = _fetch_coingecko(cg_id, days_map.get(interval, 30))
            if candles:
                source = "coingecko"

        # ── Attempt 3: Mock fallback ────────────────────────────
        if candles is None:
            bp = BASE_PRICES.get(symbol) or BIST_BASE_PRICES.get(symbol, 100)
            candles = _generate_mock_candles(bp, num_candles=60, interval=interval)
            source = "mock"

        if not candles:
            return {"error": f"No data available for {symbol}"}

        # ── Currency conversion ─────────────────────────────────
        is_bist = symbol.endswith(".IS")
        if is_bist and fiat == "USD":
            rate = get_usd_try_rate()
            for c in candles:
                c["open"] = round(c["open"] / rate, 4)
                c["high"] = round(c["high"] / rate, 4)
                c["low"] = round(c["low"] / rate, 4)
                c["close"] = round(c["close"] / rate, 4)
        elif not is_bist and fiat == "TRY":
            rate = get_usd_try_rate()
            for c in candles:
                c["open"] = round(c["open"] * rate, 2)
                c["high"] = round(c["high"] * rate, 2)
                c["low"] = round(c["low"] * rate, 2)
                c["close"] = round(c["close"] * rate, 2)

        # ── Build response ──────────────────────────────────────
        current = candles[-1]["close"]
        prev = candles[-2]["close"] if len(candles) > 1 else current
        change = current - prev
        change_pct = (change / prev * 100) if prev else 0

        return {
            "symbol": symbol,
            "name": ASSET_NAMES.get(symbol, symbol),
            "currency": fiat,
            "interval": interval,
            "current_price": round(current, 2),
            "price_change": round(change, 2),
            "price_change_percent": round(change_pct, 2),
            "source": source,
            "candles": candles,
        }

    def list_assets(self, group: str) -> List[Dict]:
        """Return summary list for a given group."""
        symbols = GROUP_MAP.get(group)
        if not symbols:
            return []
        result: List[Dict] = []
        for sym in symbols:
            name = ASSET_NAMES.get(sym, sym)
            grp = group if group not in ("commodity", "sp500") else (
                "commodities" if group == "commodity" else "sp50"
            )
            result.append({"symbol": sym, "name": name, "group": grp})
        return result


# ── Legacy wrappers (backward compat with old endpoints) ─────────
_service = MarketDataService()


def get_market_data(symbol: str, period: str = "1mo",
                    interval: str = "1d", currency: str = "USD") -> Dict:
    return _service.fetch_candles(symbol, interval=interval, fiat=currency)


def _fetch_batch_prices(symbols: List[str]) -> Dict[str, Dict]:
    """Fetch latest prices for a list of symbols via Yahoo v8 API."""
    out: Dict[str, Dict] = {}
    if not symbols:
        return out
    for sym in symbols:
        try:
            r = _http.get(
                f"{_YF_BASE}/{sym}",
                params={"interval": "1d", "range": "5d"},
                timeout=10,
            )
            if r.status_code != 200:
                continue
            data = r.json()
            result = data.get("chart", {}).get("result")
            if not result:
                continue
            quote = result[0].get("indicators", {}).get("quote", [{}])[0]
            closes = [x for x in (quote.get("close") or []) if x is not None]
            if not closes:
                continue
            c = round(float(closes[-1]), 2)
            p = round(float(closes[-2]), 2) if len(closes) > 1 else c
            chg = round(c - p, 2)
            pct = round((chg / p * 100), 2) if p != 0 else 0.0
            out[sym] = {"price": c, "change": chg, "change_pct": pct}
        except Exception as exc:
            logger.warning("Batch price %s failed: %s", sym, exc)
    return out


def get_category_data(category: str, currency: str = "USD",
                      period: str = "1mo", interval: str = "1d") -> List[Dict]:
    """Return price summaries for a category – no candles (loaded per-asset)."""
    symbols = GROUP_MAP.get(category, [])
    if not symbols:
        return []
    batch = _fetch_batch_prices(symbols)
    is_bist = (category == "bist100")
    fx = get_usd_try_rate() if (is_bist or currency == "TRY") else 1.0
    results: List[Dict] = []
    for sym in symbols:
        name = ASSET_NAMES.get(sym, sym)
        if sym in batch:
            price = batch[sym]["price"]
            chg = batch[sym]["change"]
            pct = batch[sym]["change_pct"]
            src = "yahoo"
        else:
            bp = BASE_PRICES.get(sym) or BIST_BASE_PRICES.get(sym, 100)
            price = round(bp * random.uniform(0.995, 1.005), 2)
            chg = round(price * random.uniform(-0.02, 0.02), 2)
            pct = round((chg / price) * 100, 2) if price else 0
            src = "mock"
        if is_bist and currency == "USD":
            price = round(price / fx, 4)
            chg = round(chg / fx, 4)
        elif not is_bist and currency == "TRY":
            price = round(price * fx, 2)
            chg = round(chg * fx, 2)
        results.append({
            "symbol": sym, "name": name,
            "current_price": round(price, 2),
            "price_change": round(chg, 2),
            "price_change_percent": round(pct, 2),
            "currency": currency, "source": src,
            "candles": [],
        })
    return results


def get_live_price(symbol: str) -> Dict:
    if symbol not in ALL_SYMBOLS:
        return {"error": f"Symbol {symbol} not found"}
    try:
        r = _http.get(
            f"{_YF_BASE}/{symbol}",
            params={"interval": "1m", "range": "1d"},
            timeout=10,
        )
        if r.status_code == 200:
            data = r.json()
            result = data.get("chart", {}).get("result")
            if result:
                meta = result[0].get("meta", {})
                price = meta.get("regularMarketPrice")
                if price is not None:
                    return {
                        "symbol": symbol,
                        "name": ASSET_NAMES.get(symbol, symbol),
                        "price": round(float(price), 2),
                        "timestamp": int(datetime.utcnow().timestamp()),
                        "source": "yahoo",
                    }
    except Exception as e:
        logger.warning("Live price fetch %s fallback to mock: %s", symbol, e)

    bp = BASE_PRICES.get(symbol) or BIST_BASE_PRICES.get(symbol, 100)
    return {
        "symbol": symbol,
        "name": ASSET_NAMES.get(symbol, symbol),
        "price": round(bp * random.uniform(0.995, 1.005), 2),
        "timestamp": int(datetime.utcnow().timestamp()),
        "source": "mock",
    }
