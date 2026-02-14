# Investment Return Rate — Architecture & Implementation Plan

> **Produced by**: Senior Full-Stack Engineer  
> **Date**: 2026-02-14  
> **Stack**: FastAPI · React 18 · TypeScript · MySQL 8 · Redis · Docker  

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTS (Browser)                        │
│  React 18 + TypeScript + lightweight-charts + react-router v6   │
└──────────────────────────┬──────────────────────────────────────┘
                           │  HTTPS / WSS
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                     NGINX (reverse proxy)                        │
│  • Serves static React build                                    │
│  • Proxies /api/* → backend:8000                                │
│  • Proxies /ws/*  → backend:8000 (WebSocket upgrade)            │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                   FastAPI Backend (Python 3.11)                   │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌─────────────┐               │
│  │ Auth Layer │  │ Market API │  │ WebSocket   │               │
│  │ JWT/RBAC   │  │ REST       │  │ /ws/prices  │               │
│  └─────┬──────┘  └─────┬──────┘  └──────┬──────┘               │
│        │               │                │                        │
│  ┌─────▼───────────────▼────────────────▼──────┐                │
│  │          Service Layer                       │                │
│  │  • UserService     • MarketDataService       │                │
│  │  • PreferenceService • CacheService          │                │
│  │  • RateLimiter     • ProviderRouter          │                │
│  └─────┬───────────────┬───────────────┬───────┘                │
│        │               │               │                         │
└────────┼───────────────┼───────────────┼────────────────────────┘
         │               │               │
    ┌────▼────┐    ┌─────▼─────┐   ┌─────▼──────┐
    │ MySQL 8 │    │  Redis 7  │   │ External   │
    │         │    │           │   │ APIs       │
    │ Users   │    │ Cache     │   │            │
    │ Prefs   │    │ Rate Lim  │   │ • Yahoo    │
    │ Assets  │    │ Sessions  │   │ • CoinGecko│
    └─────────┘    └───────────┘   │ • Alpha V  │
                                   └────────────┘
```

### Data Flow — Candle Request

```
Browser                Backend                 Redis           Yahoo Finance
   │                      │                      │                  │
   ├─GET /api/markets/    │                      │                  │
   │  AAPL/candles?       │                      │                  │
   │  interval=1d─────────►                      │                  │
   │                      ├─HGET candles:        │                  │
   │                      │  AAPL:1d:USD─────────►                  │
   │                      │                      │                  │
   │                      │◄─miss / expired──────┤                  │
   │                      │                      │                  │
   │                      ├─GET yfinance(AAPL)───┼──────────────────►
   │                      │                      │                  │
   │                      │◄─OHLCV data──────────┼──────────────────┤
   │                      │                      │                  │
   │                      ├─HSET candles:        │                  │
   │                      │  AAPL:1d:USD─────────►                  │
   │                      │  TTL=60s             │                  │
   │                      │                      │                  │
   │◄─JSON {candles}──────┤                      │                  │
```

---

## 2. OpenAPI-Style Endpoint Specification

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/signup` | — | Register user/admin |
| POST | `/api/login` | — | Login (any role) |
| POST | `/api/login/user` | — | User-only login |
| POST | `/api/login/admin` | — | Admin-only login |
| GET | `/api/me` | Bearer | Current user profile |
| PUT | `/api/profile` | Bearer | Update profile |

### Market Data

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/markets/list?group={group}` | — | List assets. group ∈ {bist100, sp50, crypto, commodities} |
| GET | `/api/markets/{symbol}/candles?interval={}&start={}&end={}&fiat={USD\|TRY}` | — | OHLCV candles |
| GET | `/api/markets/{symbol}/price` | — | Latest price snapshot |
| WS | `/ws/prices?symbols=AAPL,BTC-USD` | — | Live price stream |

### User Preferences

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/{username}/preferences` | Bearer (self/admin) | Get chart prefs |
| POST | `/api/users/{username}/preferences` | Bearer (self/admin) | Save chart prefs |

### Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users` | Bearer (admin) | List all users |
| PUT | `/api/users/{username}/role` | Bearer (admin) | Change user role |
| DELETE | `/api/users/{username}` | Bearer (admin) | Deactivate user |

### Endpoint Detail: `GET /api/markets/{symbol}/candles`

```yaml
parameters:
  - name: symbol
    in: path
    required: true
    schema: { type: string }
    example: "AAPL"
  - name: interval
    in: query
    schema: { type: string, enum: [5m,15m,1h,4h,1d,1w,1mo], default: "1d" }
  - name: start
    in: query
    schema: { type: string, format: date-time }
    description: "ISO 8601 start (default: interval-dependent lookback)"
  - name: end
    in: query
    schema: { type: string, format: date-time }
    description: "ISO 8601 end (default: now)"
  - name: fiat
    in: query
    schema: { type: string, enum: [USD, TRY], default: "USD" }
responses:
  200:
    content:
      application/json:
        schema:
          type: object
          properties:
            symbol: { type: string }
            name: { type: string }
            currency: { type: string }
            interval: { type: string }
            candles:
              type: array
              items:
                type: object
                properties:
                  time: { type: integer, description: "Unix epoch seconds" }
                  open: { type: number }
                  high: { type: number }
                  low: { type: number }
                  close: { type: number }
                  volume: { type: integer }
```

---

## 3. Database Schema

```sql
-- Users table (existing, enhanced)
CREATE TABLE users (
    username        VARCHAR(255) PRIMARY KEY,
    email           VARCHAR(255) UNIQUE NOT NULL,
    full_name       VARCHAR(255),
    phone           VARCHAR(20),
    hashed_password VARCHAR(255) NOT NULL,
    role            ENUM('admin','user') DEFAULT 'user',
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- User chart preferences (NEW)
CREATE TABLE user_preferences (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    username        VARCHAR(255) NOT NULL,
    background_color VARCHAR(9) DEFAULT '#131722',
    up_color        VARCHAR(9) DEFAULT '#26a69a',
    down_color      VARCHAR(9) DEFAULT '#ef5350',
    up_border_color VARCHAR(9) DEFAULT '#26a69a',
    down_border_color VARCHAR(9) DEFAULT '#ef5350',
    shell_color     VARCHAR(9) DEFAULT '#1e222d',
    default_interval VARCHAR(5) DEFAULT '1d',
    default_fiat    VARCHAR(3) DEFAULT 'USD',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
);

-- Known assets / symbol registry (NEW)
CREATE TABLE assets (
    symbol          VARCHAR(30) PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    asset_group     ENUM('bist100','sp50','crypto','commodities') NOT NULL,
    base_currency   VARCHAR(5) DEFAULT 'USD',
    is_active       BOOLEAN DEFAULT TRUE,
    yahoo_symbol    VARCHAR(30),
    coingecko_id    VARCHAR(50),
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Provider config (NEW)
CREATE TABLE data_providers (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(50) NOT NULL UNIQUE,
    base_url        VARCHAR(255),
    api_key_env     VARCHAR(50),
    priority        INT DEFAULT 0,
    rate_limit_rpm  INT DEFAULT 60,
    is_active       BOOLEAN DEFAULT TRUE
);

-- Cached candles (optional — Redis is primary, this is cold storage)
CREATE TABLE cached_candles (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    symbol          VARCHAR(30) NOT NULL,
    interval_tf     VARCHAR(5) NOT NULL,
    currency        VARCHAR(5) DEFAULT 'USD',
    candle_time     INT NOT NULL,
    open_p          DECIMAL(18,8),
    high_p          DECIMAL(18,8),
    low_p           DECIMAL(18,8),
    close_p         DECIMAL(18,8),
    volume          BIGINT,
    fetched_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY ux_candle (symbol, interval_tf, currency, candle_time),
    INDEX ix_sym_interval (symbol, interval_tf)
);
```

---

## 4. Backend Implementation — `GET /api/markets/{symbol}/candles`

See **backend/main.py** (updated) and **backend/market_data.py** (rewritten) for full implementation. Key endpoint:

```python
# ── backend/main.py (candles endpoint) ──────────────────────────
from fastapi import Query
from market_data import MarketDataService

market_service = MarketDataService()

@app.get("/api/markets/{symbol}/candles")
async def get_candles(
    symbol: str,
    interval: str = Query("1d", regex="^(5m|15m|1h|4h|1d|1w|1mo)$"),
    start: Optional[str] = None,
    end: Optional[str] = None,
    fiat: str = Query("USD", regex="^(USD|TRY)$"),
):
    """
    Fetch OHLCV candles for a symbol.
    Checks Redis cache first, then falls back to Yahoo Finance / CoinGecko.
    BIST symbols auto-convert to TRY when fiat=TRY.
    """
    cache_key = f"candles:{symbol}:{interval}:{fiat}"
    
    # 1. Check Redis
    cached = await redis.get(cache_key)
    if cached:
        return json.loads(cached)

    # 2. Fetch from provider
    result = market_service.fetch_candles(
        symbol=symbol, interval=interval,
        start=start, end=end, fiat=fiat
    )
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    # 3. Cache with TTL based on interval
    ttl_map = {"5m": 30, "15m": 60, "1h": 120, "4h": 300, "1d": 600, "1w": 3600, "1mo": 3600}
    ttl = ttl_map.get(interval, 60)
    await redis.setex(cache_key, ttl, json.dumps(result))

    return result
```

Full `MarketDataService` with Yahoo Finance + CoinGecko fallback is implemented in `backend/market_data.py`.

---

## 5. Frontend CandlestickChart Component

See **frontend/src/components/CandlestickChart.tsx** (updated). Key features:
- Configurable background, candle body, wick/border, and shell (container) colors
- Timeframe selector integration
- Per-user preference persistence via API
- WebSocket live updates with polling fallback

```tsx
// Sketch — see actual file for full implementation
const CandlestickChart: React.FC<Props> = ({ data, height = 500 }) => {
  const { settings } = useChartSettings();
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const chart = createChart(chartContainerRef.current!, {
      width: chartContainerRef.current!.clientWidth,
      height,
      layout: {
        background: { color: settings.backgroundColor },
        textColor: settings.textColor,
      },
      grid: {
        vertLines: { color: settings.gridColor },
        horzLines: { color: settings.gridColor },
      },
    });

    const series = chart.addCandlestickSeries({
      upColor: settings.upColor,
      downColor: settings.downColor,
      borderUpColor: settings.upBorderColor,
      borderDownColor: settings.downBorderColor,
      wickUpColor: settings.upBorderColor,
      wickDownColor: settings.downBorderColor,
    });

    series.setData(data);
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [data, height, settings]);

  return (
    <div style={{ border: `2px solid ${settings.shellColor}`, borderRadius: 8 }}>
      <div ref={chartContainerRef} />
    </div>
  );
};
```

---

## 6. Example curl Requests & Responses

### Sign Up
```bash
curl -X POST http://localhost:8000/api/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"trader@example.com","username":"trader1","password":"S3cure!Pass","role":"user"}'
```
```json
{ "access_token": "eyJhbGciOiJIUzI1NiIs...", "token_type": "bearer" }
```

### Login
```bash
curl -X POST http://localhost:8000/api/login/user \
  -H "Content-Type: application/json" \
  -d '{"username":"trader1","password":"S3cure!Pass"}'
```
```json
{ "access_token": "eyJhbGciOiJIUzI1NiIs...", "token_type": "bearer" }
```

### Get Candles
```bash
curl "http://localhost:8000/api/markets/AAPL/candles?interval=1d&fiat=USD"
```
```json
{
  "symbol": "AAPL",
  "name": "Apple Inc.",
  "currency": "USD",
  "interval": "1d",
  "candles": [
    { "time": 1707868800, "open": 224.50, "high": 226.80, "low": 223.10, "close": 225.90, "volume": 54230000 },
    { "time": 1707955200, "open": 225.90, "high": 228.40, "low": 225.00, "close": 227.60, "volume": 48100000 }
  ]
}
```

### Get BIST in TRY
```bash
curl "http://localhost:8000/api/markets/THYAO.IS/candles?interval=1h&fiat=TRY"
```
```json
{
  "symbol": "THYAO.IS",
  "name": "Turkish Airlines",
  "currency": "TRY",
  "interval": "1h",
  "candles": [
    { "time": 1707868800, "open": 310.50, "high": 312.80, "low": 309.20, "close": 311.60, "volume": 12300000 }
  ]
}
```

### List Assets by Group
```bash
curl "http://localhost:8000/api/markets/list?group=crypto"
```
```json
[
  { "symbol": "BTC-USD", "name": "Bitcoin", "group": "crypto", "current_price": 95230.50, "price_change_percent": 1.24 },
  { "symbol": "ETH-USD", "name": "Ethereum", "group": "crypto", "current_price": 3520.80, "price_change_percent": -0.35 }
]
```

### Save Preferences
```bash
curl -X POST http://localhost:8000/api/users/trader1/preferences \
  -H "Authorization: Bearer eyJhbG..." \
  -H "Content-Type: application/json" \
  -d '{
    "background_color": "#131722",
    "up_color": "#26a69a",
    "down_color": "#ef5350",
    "up_border_color": "#26a69a",
    "down_border_color": "#ef5350",
    "shell_color": "#1e222d",
    "default_interval": "1d",
    "default_fiat": "USD"
  }'
```
```json
{ "status": "saved", "username": "trader1" }
```

### Admin: List Users
```bash
curl -H "Authorization: Bearer eyJhbG..<admin_token>" \
  http://localhost:8000/api/users
```
```json
[
  { "username": "trader1", "email": "trader@example.com", "role": "user", "is_active": true },
  { "username": "admin1", "email": "admin@example.com", "role": "admin", "is_active": true }
]
```

---

## 7. Caching & Rate-Limit Strategy

### Redis Key Patterns

| Pattern | Purpose | TTL |
|---------|---------|-----|
| `candles:{symbol}:{interval}:{fiat}` | OHLCV cache | 30s (5m) → 3600s (1mo) |
| `price:{symbol}` | Latest price | 15s |
| `list:{group}` | Asset list cache | 300s |
| `rate:{ip}:{endpoint}` | Per-IP rate counter | 60s window |
| `rate:provider:{name}` | Provider call counter | 60s window |
| `fx:USDTRY` | FX rate cache | 300s |
| `prefs:{username}` | User preferences | 3600s |

### Rate-Limit Rules

| Scope | Limit | Window | Action |
|-------|-------|--------|--------|
| Anonymous API | 60 req | 60s | 429 Too Many Requests |
| Authenticated API | 120 req | 60s | 429 |
| Admin API | 300 req | 60s | 429 |
| Yahoo Finance calls | 2000/day | 24h | Switch to fallback |
| CoinGecko calls | 30/min | 60s | Queue / delay |
| WebSocket connections | 5 per user | — | Reject new |

### Cache TTL by Interval

| Interval | TTL (seconds) | Rationale |
|----------|--------------|-----------|
| 5m | 30 | Near-realtime |
| 15m | 60 | Short-term |
| 1h | 120 | Medium |
| 4h | 300 | 5 minutes |
| 1d | 600 | 10 minutes |
| 1w | 3600 | 1 hour |
| 1mo | 3600 | 1 hour |

### Provider Fallback Chain

```
Yahoo Finance (primary, free)
  └─ fail/rate-limited → CoinGecko (crypto only)
  └─ fail/rate-limited → Alpha Vantage (stocks, 25 req/day free)
  └─ fail → Return cached stale data with warning header
  └─ no cache → 503 Service Unavailable
```

---

## 8. Implementation Roadmap (3 Sprints)

### Sprint 1 — Foundation (Week 1–2)
| # | Task | Priority | Est |
|---|------|----------|-----|
| 1.1 | Add Redis to docker-compose | P0 | 1h |
| 1.2 | Add `user_preferences`, `assets`, `data_providers` tables | P0 | 2h |
| 1.3 | Implement live Yahoo Finance data fetching (replace mock) | P0 | 4h |
| 1.4 | Implement CoinGecko fallback for crypto | P0 | 2h |
| 1.5 | Build `GET /api/markets/{symbol}/candles` with cache | P0 | 3h |
| 1.6 | Build `GET /api/markets/list?group=` | P0 | 2h |
| 1.7 | Add Redis caching layer with TTLs | P0 | 3h |
| 1.8 | Fix existing bugs (email typo, missing full_name) | P0 | 1h |
| 1.9 | Add preferences CRUD endpoints | P1 | 2h |
| 1.10 | Add shell color to ChartContext | P1 | 1h |

### Sprint 2 — UX & Security (Week 3–4)
| # | Task | Priority | Est |
|---|------|----------|-----|
| 2.1 | Apply monochrome professional theme (CSS tokens) | P0 | 4h |
| 2.2 | Add rate limiting middleware (slowapi) | P0 | 2h |
| 2.3 | WebSocket `/ws/prices` for live updates | P1 | 4h |
| 2.4 | Polling fallback when WS unavailable | P1 | 2h |
| 2.5 | Frontend preferences sync (API ↔ localStorage) | P1 | 3h |
| 2.6 | Admin user management panel | P1 | 3h |
| 2.7 | Input validation & sanitization hardening | P1 | 2h |
| 2.8 | TRY/USD toggle with live FX rate | P1 | 2h |
| 2.9 | Responsive mobile layout polish | P2 | 3h |

### Sprint 3 — Reliability & Scale (Week 5–6)
| # | Task | Priority | Est |
|---|------|----------|-----|
| 3.1 | Provider fallback chain implementation | P0 | 4h |
| 3.2 | Unit tests (pytest) for market_data, auth | P0 | 4h |
| 3.3 | Integration tests for endpoints | P0 | 3h |
| 3.4 | Frontend tests (React Testing Library) | P1 | 3h |
| 3.5 | E2E tests (Playwright) for chart flow | P1 | 4h |
| 3.6 | CI pipeline (GitHub Actions) | P1 | 2h |
| 3.7 | HTTPS + security headers config | P2 | 2h |
| 3.8 | Performance profiling & optimization | P2 | 3h |
| 3.9 | Documentation & README rewrite | P2 | 2h |

---

## 9. External APIs — Usage & Symbol Mapping

### Yahoo Finance (via `yfinance` Python library)
- **Cost**: Free (unofficial API)
- **Rate Limit**: ~2000 requests/day, 5 req/sec recommended
- **Symbol Mapping**:
  - US stocks: ticker as-is → `AAPL`, `MSFT`
  - BIST: append `.IS` → `THYAO.IS`, `ASELS.IS`
  - Crypto: append `-USD` → `BTC-USD`, `ETH-USD`
  - Gold: `GC=F`, Silver: `SI=F`
  - USD/TRY rate: `USDTRY=X`
- **Intervals**: 1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo
- **Notes**: Intraday data limited to last 60 days for 5m+. 1m limited to 7 days.

### CoinGecko (REST API)
- **Cost**: Free tier (Demo API key, 30 calls/min)
- **Endpoint**: `GET /api/v3/coins/{id}/ohlc?vs_currency=usd&days=30`
- **Symbol Mapping**: `bitcoin`, `ethereum`
- **Notes**: OHLC only at 1d/4h granularity on free tier. Use for fallback.

### Alpha Vantage (REST API)
- **Cost**: Free (25 req/day), Premium from $49/mo
- **Endpoint**: `GET /query?function=TIME_SERIES_INTRADAY&symbol=AAPL&interval=5min`
- **Notes**: Very low free limit. Use as last-resort fallback.

### Finnhub (REST + WebSocket)
- **Cost**: Free tier (60 calls/min)
- **WebSocket**: Real-time trades for US stocks
- **Notes**: Good for live price streaming. No OHLC aggregation on free tier.

### BIST Constituent List
- Yahoo Finance query: fetch all `.IS` suffixed tickers
- Fallback scraping: `https://www.isyatirim.com.tr` → BIST100 list
- Or hardcode the 100 symbols and update quarterly

### FX Rate (USD/TRY)
- Yahoo Finance: `yfinance.download("USDTRY=X")`
- Cache for 5 minutes
- Fallback: European Central Bank free XML feed

---

## 10. Testing Checklist

### Unit Tests
- [ ] `test_generate_candles` — correct OHLCV structure, length, time ordering
- [ ] `test_yahoo_symbol_mapping` — BIST `.IS`, crypto `-USD`, commodities `=F`
- [ ] `test_currency_conversion` — USD→TRY and TRY→USD with mock FX rate
- [ ] `test_jwt_create_verify` — token creation, expiry, invalid signature
- [ ] `test_password_hash_verify` — bcrypt round-trip
- [ ] `test_rbac_admin_only` — admin endpoints reject user tokens
- [ ] `test_rate_limiter` — counter increments, blocks after limit
- [ ] `test_cache_key_format` — correct Redis key pattern generation
- [ ] `test_preference_save_load` — round-trip preferences

### Integration Tests
- [ ] `test_signup_login_flow` — register → login → get /me
- [ ] `test_candles_endpoint` — valid symbol returns OHLCV
- [ ] `test_candles_caching` — second call hits cache (no provider call)
- [ ] `test_candles_invalid_symbol` — returns 404
- [ ] `test_candles_invalid_interval` — returns 422
- [ ] `test_list_endpoint` — each group returns correct symbols
- [ ] `test_preferences_persist` — save → fetch matches
- [ ] `test_admin_user_list` — admin sees all users
- [ ] `test_user_cannot_admin` — user token on admin endpoint → 403

### End-to-End Tests (Playwright / Cypress)
- [ ] `test_chart_renders` — navigate to market, select asset, canvas appears
- [ ] `test_timeframe_switch` — click 1h, chart re-renders with new data
- [ ] `test_currency_toggle` — BIST asset, click TRY, prices update
- [ ] `test_chart_settings` — open modal, change color, chart updates
- [ ] `test_login_flow` — sign in → redirected to market
- [ ] `test_admin_login` — admin login → can see user list
- [ ] `test_responsive` — viewport 375px, sidebar collapses
- [ ] `test_websocket_fallback` — disconnect WS, polling activates

---

## CSS / Theme Tokens

```css
:root {
  /* Surface */
  --color-bg-primary: #0d0d0d;
  --color-bg-secondary: #1a1a1a;
  --color-bg-tertiary: #242424;
  --color-bg-card: #1e1e1e;
  
  /* Text */
  --color-text-primary: #f5f5f5;
  --color-text-secondary: #a0a0a0;
  --color-text-muted: #666666;
  
  /* Borders */
  --color-border: #2a2a2a;
  --color-border-hover: #404040;
  
  /* Accents */
  --color-accent: #ffffff;
  --color-positive: #26a69a;
  --color-negative: #ef5350;
  --color-warning: #ffb74d;
  
  /* Chart */
  --chart-bg: #131722;
  --chart-grid: #1e222d;
  --chart-text: #d1d4dc;
  --chart-shell: #1e222d;
  
  /* Spacing */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  
  /* Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  
  /* Font */
  --font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --font-size-xs: 11px;
  --font-size-sm: 13px;
  --font-size-md: 15px;
  --font-size-lg: 18px;
  --font-size-xl: 24px;
  --font-size-2xl: 32px;
}
```
