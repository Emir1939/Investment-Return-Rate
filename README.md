# Quant Dashboard v2.0

A professional-grade finance web application for real-time market data, candlestick charting, and portfolio tracking. Built with **FastAPI** (Python 3.11) backend, **React 18** (TypeScript) frontend, **MySQL 8**, and **Redis 7** — all orchestrated via Docker Compose.

---

## Features

- Live candlestick charts (lightweight-charts) with configurable colors & shell border
- Real-time market data from **Yahoo Finance** with **CoinGecko** crypto fallback
- 150+ assets: BIST-100, S&P 500 Top 50, BTC/ETH, Gold/Silver
- Multi-timeframe support: 5m, 15m, 1h, 4h, 1D, 1W, 1M
- USD / TRY currency toggle with live FX conversion
- JWT authentication with RBAC (admin / user roles)
- WebSocket endpoint for streaming price updates
- Redis caching with TTL-based expiry per interval
- In-memory rate limiting (120 req / 60s per IP)
- User preferences sync (chart colors, interval, fiat) stored server-side
- Professional monochrome (black/white/grey) dark UI theme
- Responsive design — desktop, tablet, and mobile

## Architecture

```
┌─────────┐       ┌─────────┐       ┌─────────┐
│  React  │──────▶│  nginx  │──────▶│ FastAPI │
│   SPA   │  :80  │  proxy  │ /api  │  :8000  │
└─────────┘       └─────────┘       └────┬────┘
                       │ /ws             │
                       └────────────────▶│
                                    ┌────┴────┐
                              ┌─────┤  Redis  │
                              │     │  :6379  │
                              │     └─────────┘
                              │
                         ┌────┴────┐
                         │  MySQL  │
                         │  :3306  │
                         └─────────┘
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for full details: OpenAPI spec, DB schema, caching strategy, implementation roadmap, testing checklist, and more.

## Prerequisites

- **Docker** & **Docker Compose** (recommended)
- Or manually: Python 3.11+, Node.js 18+, MySQL 8, Redis 7

## Quick Start (Docker)

```bash
# Clone the repo
git clone <repo-url> && cd Investment-Return-Rate

# Start all services
docker compose up --build -d

# Frontend:  http://localhost:3000
# Backend:   http://localhost:8000
# MySQL:     localhost:3307
# Redis:     localhost:6379
```

## Manual Setup

### Backend

```bash
cd backend
python -m venv venv
# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
python main.py
```

Backend runs at `http://localhost:8000`. Requires `DATABASE_URL` and optional `REDIS_URL` env vars.

### Frontend

```bash
cd frontend
npm install
npm start
```

Frontend runs at `http://localhost:3000`. Set `REACT_APP_API_URL` to override the backend URL.

## API Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/signup` | Register a new user | - |
| POST | `/api/login` | Login, returns JWT | - |
| GET | `/api/me` | Current user info | Bearer |
| GET | `/api/users` | List all users | Admin |
| DELETE | `/api/users/{username}` | Delete a user | Admin |
| GET | `/api/markets/list?group=` | List available assets | Bearer |
| GET | `/api/markets/{symbol}/candles` | OHLCV candle data (cached) | Bearer |
| GET | `/api/markets/{symbol}/price` | Latest price | Bearer |
| GET | `/api/users/{username}/preferences` | Get chart preferences | Bearer |
| POST | `/api/users/{username}/preferences` | Save chart preferences | Bearer |
| WS | `/ws/prices` | Real-time price stream | - |

### Example Requests

```bash
# Register
curl -X POST http://localhost:8000/api/signup \
  -H "Content-Type: application/json" \
  -d '{"username":"demo","email":"demo@example.com","password":"secret123","full_name":"Demo User"}'

# Login
curl -X POST http://localhost:8000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"demo","password":"secret123"}'

# Get candles (replace <TOKEN>)
curl "http://localhost:8000/api/markets/AAPL/candles?interval=1d&currency=USD" \
  -H "Authorization: Bearer <TOKEN>"
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, lightweight-charts 4, react-color |
| Backend | FastAPI, SQLAlchemy, python-jose (JWT), bcrypt, yfinance |
| Database | MySQL 8.0 |
| Cache | Redis 7 (Alpine) |
| Proxy | nginx |
| Infra | Docker Compose |

## Project Structure

```
├── ARCHITECTURE.md          # Full technical plan (10 sections)
├── docker-compose.yml       # 4-service stack (db, redis, backend, frontend)
├── backend/
│   ├── main.py              # FastAPI app, endpoints, WS, rate limiter
│   ├── database.py          # SQLAlchemy models (User, Asset, CachedCandle…)
│   ├── market_data.py       # Yahoo Finance + CoinGecko + mock fallback
│   ├── requirements.txt
│   └── Dockerfile
└── frontend/
    ├── nginx.conf           # Reverse proxy + WebSocket upgrade
    ├── Dockerfile
    ├── package.json
    └── src/
        ├── App.tsx
        ├── index.css         # CSS custom properties (monochrome theme)
        ├── context/
        │   ├── AuthContext.tsx
        │   └── ChartContext.tsx
        └── components/
            ├── Market.tsx / Market.css
            ├── CandlestickChart.tsx
            ├── ChartSettings.tsx / ChartSettings.css
            ├── Dashboard.tsx / Dashboard.css
            ├── Profile.tsx / Profile.css
            ├── SignIn.tsx / SignUp.tsx / Auth.css
            └── AdminLogin.tsx
```

## Security

- Passwords hashed with **bcrypt** (12 rounds)
- JWT HS256 tokens (30-min expiry)
- CORS restricted origins
- Rate limiting per IP
- SQL injection prevention via SQLAlchemy ORM

## Contributing

Contributions are welcome. Please open an issue or submit a pull request.

## License

MIT
