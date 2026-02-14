import yfinance as yf
from typing import List, Dict, Optional
from datetime import datetime, timedelta
import pandas as pd
import requests
import random
import numpy as np

# Configure yfinance session with proper headers
session = requests.Session()
session.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
})

# Base prices for realistic mock data
BASE_PRICES = {
    "BTC-USD": 95000,
    "ETH-USD": 3500,
    "GC=F": 2050,  # Gold
    "SI=F": 24,     # Silver
    "AAPL": 225, "MSFT": 425, "GOOGL": 175, "AMZN": 195, "NVDA": 140,
    "META": 565, "TSLA": 350, "UNH": 520, "JNJ": 160, "XOM": 115,
    "V": 305, "JPM": 235, "PG": 170, "MA": 510, "HD": 380,
    "CVX": 164, "MRK": 98, "ABBV": 190, "PEP": 160, "COST": 880,
    "AVGO": 220, "KO": 62, "ADBE": 490, "TMO": 520, "MCD": 285,
    "CSCO": 58, "ACN": 360, "LIN": 470, "NFLX": 885, "ABT": 120,
    "WMT": 92, "CRM": 295, "DHR": 240, "VZ": 42, "NKE": 76,
    "CMCSA": 38, "TXN": 190, "ORCL": 170, "DIS": 110, "NEE": 68,
    "PM": 125, "UPS": 130, "BMY": 52, "RTX": 125, "INTC": 21,
    "HON": 230, "QCOM": 155, "AMD": 120, "LOW": 260, "BRK-B": 475
}

# Add BIST 100 base prices (in TRY)
BIST_BASE_PRICES = {
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
    "CIMSA.IS": 72, "ANACM.IS": 55
}

# Asset names
ASSET_NAMES = {
    "BTC-USD": "Bitcoin",
    "ETH-USD": "Ethereum",
    "GC=F": "Gold",
    "SI=F": "Silver",
    "AAPL": "Apple Inc.", "MSFT": "Microsoft Corporation", "GOOGL": "Alphabet Inc.",
    "AMZN": "Amazon.com Inc.", "NVDA": "NVIDIA Corporation", "META": "Meta Platforms Inc.",
    "TSLA": "Tesla Inc.", "UNH": "UnitedHealth Group", "JNJ": "Johnson & Johnson",
    "XOM": "Exxon Mobil Corporation", "V": "Visa Inc.", "JPM": "JPMorgan Chase & Co.",
    "PG": "Procter & Gamble", "MA": "Mastercard Inc.", "HD": "The Home Depot",
    "CVX": "Chevron Corporation", "MRK": "Merck & Co.", "ABBV": "AbbVie Inc.",
    "PEP": "PepsiCo Inc.", "COST": "Costco Wholesale", "AVGO": "Broadcom Inc.",
    "KO": "The Coca-Cola Company", "ADBE": "Adobe Inc.", "TMO": "Thermo Fisher Scientific",
    "MCD": "McDonald's Corporation", "CSCO": "Cisco Systems", "ACN": "Accenture plc",
    "LIN": "Linde plc", "NFLX": "Netflix Inc.", "ABT": "Abbott Laboratories",
    "WMT": "Walmart Inc.", "CRM": "Salesforce Inc.", "DHR": "Danaher Corporation",
    "VZ": "Verizon Communications", "NKE": "Nike Inc.", "CMCSA": "Comcast Corporation",
    "TXN": "Texas Instruments", "ORCL": "Oracle Corporation", "DIS": "The Walt Disney Company",
    "NEE": "NextEra Energy", "PM": "Philip Morris", "UPS": "United Parcel Service",
    "BMY": "Bristol Myers Squibb", "RTX": "RTX Corporation", "INTC": "Intel Corporation",
    "HON": "Honeywell International", "QCOM": "Qualcomm Inc.", "AMD": "Advanced Micro Devices",
    "LOW": "Lowe's Companies", "BRK-B": "Berkshire Hathaway",
    # BIST stocks
    "ASELS.IS": "Aselsan", "THYAO.IS": "Turkish Airlines", "EREGL.IS": "Ereğli Demir Çelik",
    "SAHOL.IS": "Sabancı Holding", "GARAN.IS": "Garanti BBVA", "ISCTR.IS": "İş Bankası (C)",
    "AKBNK.IS": "Akbank", "SISE.IS": "Şişe Cam", "KCHOL.IS": "Koç Holding",
    "YKBNK.IS": "Yapı Kredi", "PETKM.IS": "Petkim", "TUPRS.IS": "Tüpraş",
    "KOZAA.IS": "Koza Altın", "KOZAL.IS": "Koza Anadolu", "TAVHL.IS": "TAV Havalimanları",
    "TCELL.IS": "Turkcell", "ENKAI.IS": "Enka İnşaat", "TTKOM.IS": "Türk Telekom",
    "PGSUS.IS": "Pegasus", "SOKM.IS": "Şok Marketler", "BIMAS.IS": "BİM",
    "FROTO.IS": "Ford Otosan", "KRDMD.IS": "Kardemir (D)", "TOASO.IS": "Tofaş",
    "OYAKC.IS": "Oyak Çimento", "HEKTS.IS": "Hektaş", "DOHOL.IS": "Doğan Holding",
    "VESTL.IS": "Vestel", "BRYAT.IS": "Borusan Yatırım", "ARCLK.IS": "Arçelik",
    "GUBRF.IS": "Gübre Fabrikaları", "LOGO.IS": "Logo Yazılım", "EKGYO.IS": "Emlak Konut GYO",
    "ODAS.IS": "Odaş", "MGROS.IS": "Migros", "SODA.IS": "Soda Sanayi",
    "ULKER.IS": "Ülker Bisküvi", "AEFES.IS": "Anadolu Efes", "TTRAK.IS": "Türk Traktör",
    "CCOLA.IS": "Coca-Cola İçecek", "OTKAR.IS": "Otokar", "DOAS.IS": "Doğuş Otomotiv",
    "GOODY.IS": "Goodyear", "HALKB.IS": "Halkbank", "VAKBN.IS": "Vakıfbank",
    "SASA.IS": "Sasa Polyester", "EGEEN.IS": "Ege Endüstri", "ALARK.IS": "Alarko Holding",
    "CIMSA.IS": "Çimsa", "ANACM.IS": "Anadolu Cam"
}

# Interval to timedelta mapping
INTERVAL_DELTAS = {
    "5m": timedelta(minutes=5),
    "15m": timedelta(minutes=15),
    "1h": timedelta(hours=1),
    "4h": timedelta(hours=4),
    "1d": timedelta(days=1),
    "1wk": timedelta(weeks=1),
    "1mo": timedelta(days=30),
}

def generate_mock_candles(base_price: float, num_candles: int = 30, volatility: float = 0.02, interval: str = "1d") -> List[Dict]:
    """
    Generate realistic mock candlestick data for any time interval
    """
    candles = []
    delta = INTERVAL_DELTAS.get(interval, timedelta(days=1))
    current_time = datetime.now() - (delta * num_candles)
    current_price = base_price

    # Adjust volatility based on interval
    vol_scale = {
        "5m": 0.002, "15m": 0.004, "1h": 0.008,
        "4h": 0.012, "1d": 0.02, "1wk": 0.04, "1mo": 0.08
    }
    scaled_vol = vol_scale.get(interval, volatility)

    for _ in range(num_candles):
        change = random.uniform(-scaled_vol, scaled_vol)
        open_price = current_price
        close_price = current_price * (1 + change)

        high_price = max(open_price, close_price) * random.uniform(1.001, 1.015)
        low_price = min(open_price, close_price) * random.uniform(0.985, 0.999)

        volume = int(random.uniform(1000000, 10000000))

        candles.append({
            "time": int(current_time.timestamp()),
            "open": round(open_price, 2),
            "high": round(high_price, 2),
            "low": round(low_price, 2),
            "close": round(close_price, 2),
            "volume": volume
        })

        current_price = close_price
        current_time += delta

    return candles

# Asset symbols for different categories
CRYPTO_SYMBOLS = {
    "BTC": "BTC-USD",
    "ETH": "ETH-USD"
}

COMMODITY_SYMBOLS = {
    "GOLD": "GC=F",
    "SILVER": "SI=F"
}

# Top 50 S&P 500 stocks
SP500_TOP_50 = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B", "UNH", "JNJ",
    "XOM", "V", "JPM", "PG", "MA", "HD", "CVX", "MRK", "ABBV", "PEP",
    "COST", "AVGO", "KO", "ADBE", "TMO", "MCD", "CSCO", "ACN", "LIN", "NFLX",
    "ABT", "WMT", "CRM", "DHR", "VZ", "NKE", "CMCSA", "TXN", "ORCL", "DIS",
    "NEE", "PM", "UPS", "BMY", "RTX", "INTC", "HON", "QCOM", "AMD", "LOW"
]

# BIST 100 stocks (example - you may need to update with accurate symbols)
BIST_100 = [
    "ASELS.IS", "THYAO.IS", "EREGL.IS", "SAHOL.IS", "GARAN.IS", "ISCTR.IS", "AKBNK.IS", "SISE.IS", 
    "KCHOL.IS", "YKBNK.IS", "PETKM.IS", "TUPRS.IS", "KOZAA.IS", "KOZAL.IS", "TAVHL.IS", "TCELL.IS",
    "ENKAI.IS", "TTKOM.IS", "PGSUS.IS", "SOKM.IS", "BIMAS.IS", "FROTO.IS", "KRDMD.IS", "TOASO.IS",
    "OYAKC.IS", "HEKTS.IS", "DOHOL.IS", "VESTL.IS", "BRYAT.IS", "ARCLK.IS", "GUBRF.IS", "LOGO.IS",
    "EKGYO.IS", "ODAS.IS", "MGROS.IS", "SODA.IS", "ULKER.IS", "AEFES.IS", "TTRAK.IS", "CCOLA.IS",
    "OTKAR.IS", "DOAS.IS", "GOODY.IS", "HALKB.IS", "VAKBN.IS", "SASA.IS", "EGEEN.IS", "ALARK.IS",
    "CIMSA.IS", "ANACM.IS"
]

def get_market_data(symbol: str, period: str = "1mo", interval: str = "1d", currency: str = "USD") -> Dict:
    """
    Fetch market data for a given symbol - Using mock data for demo
    """
    try:
        # Get base price
        base_price = BASE_PRICES.get(symbol) or BIST_BASE_PRICES.get(symbol)
        
        if not base_price:
            return {"error": f"Symbol {symbol} not found"}
        
        # Determine number of candles based on period and interval
        num_candles_map = {
            "1d": 288,    # 5-minute candles
            "5d": 480,    # 15-minute candles
            "1mo": 720,   # hourly candles or 30 daily
            "3mo": 540,   # 4-hour candles
            "6mo": 180,   # daily candles
            "1y": 365,    # daily candles
        }
        num_candles = num_candles_map.get(period, 30)
        
        candles = generate_mock_candles(base_price, num_candles=num_candles, interval=interval)
        
        # Get current price and calculate changes
        current_price = candles[-1]["close"]
        previous_close = candles[-2]["close"] if len(candles) > 1 else current_price
        price_change = current_price - previous_close
        price_change_percent = (price_change / previous_close * 100) if previous_close != 0 else 0
        
        # Currency conversion for BIST stocks
        if currency == "TRY" and ".IS" in symbol:
            # BIST prices are already in TRY
            pass
        elif currency == "USD" and ".IS" in symbol:
            # Convert TRY to USD (mock rate: 1 USD = 34 TRY)
            usd_try_rate = 34.5
            current_price /= usd_try_rate
            price_change /= usd_try_rate
            
            for candle in candles:
                candle['open'] /= usd_try_rate
                candle['high'] /= usd_try_rate
                candle['low'] /= usd_try_rate
                candle['close'] /= usd_try_rate
        
        # Get asset name
        asset_name = ASSET_NAMES.get(symbol, symbol)
        
        return {
            "symbol": symbol,
            "name": asset_name,
            "current_price": round(current_price, 2),
            "price_change": round(price_change, 2),
            "price_change_percent": round(price_change_percent, 2),
            "currency": currency,
            "candles": candles
        }
    except Exception as e:
        return {"error": str(e)}

def get_category_data(category: str, currency: str = "USD", period: str = "1mo", interval: str = "1d") -> List[Dict]:
    """
    Get market data for all symbols in a category
    """
    symbols = []
    
    if category == "crypto":
        symbols = list(CRYPTO_SYMBOLS.values())
    elif category == "commodity":
        symbols = list(COMMODITY_SYMBOLS.values())
    elif category == "sp500":
        symbols = SP500_TOP_50
    elif category == "bist100":
        symbols = BIST_100
    else:
        return [{"error": "Invalid category"}]
    
    results = []
    for symbol in symbols:
        data = get_market_data(symbol, period=period, interval=interval, currency=currency)
        if "error" not in data:
            results.append(data)
    
    return results

def get_live_price(symbol: str) -> Dict:
    """
    Get live price for a symbol - Using mock data
    """
    try:
        # Get base price
        base_price = BASE_PRICES.get(symbol) or BIST_BASE_PRICES.get(symbol)
        
        if not base_price:
            return {"error": f"Symbol {symbol} not found"}
        
        # Add small random variation for "live" effect
        live_price = base_price * random.uniform(0.995, 1.005)
        
        return {
            "symbol": symbol,
            "price": round(live_price, 2),
            "timestamp": int(datetime.now().timestamp())
        }
    except Exception as e:
        return {"error": str(e)}
