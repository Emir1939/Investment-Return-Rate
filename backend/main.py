"""
Investment Return Rate — FastAPI Backend
Endpoints: auth, market data (live + cached), user preferences, admin, WebSocket
"""

from fastapi import FastAPI, HTTPException, Depends, status, Query, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, EmailStr
import bcrypt
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional, List, Dict
from sqlalchemy.orm import Session
import asyncio
import json
import logging
import os

from database import (
    init_db, get_db, seed_assets,
    User as DBUser, UserRole, UserPreference,
)
from market_data import MarketDataService, get_live_price, GROUP_MAP
import portfolio_service

# ── Redis (optional — degrades gracefully) ───────────────────────
try:
    import redis
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    redis_client = redis.from_url(REDIS_URL, decode_responses=True)
    redis_client.ping()
    REDIS_AVAILABLE = True
except Exception:
    redis_client = None
    REDIS_AVAILABLE = False

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# ── App ──────────────────────────────────────────────────────────
app = FastAPI(title="Investment Return Rate API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", "http://localhost:80",
        "http://frontend:80", "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-here-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")
market_service = MarketDataService()

# ── Cache TTL per interval ───────────────────────────────────────
CACHE_TTL: Dict[str, int] = {
    "5m": 30, "15m": 60, "1h": 120,
    "4h": 300, "1d": 600, "1w": 3600, "1mo": 3600,
}


# ── Rate limiting (in-memory, simple) ────────────────────────────
_rate_buckets: Dict[str, list] = {}
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX = 120     # requests per window


def _check_rate_limit(client_ip: str) -> bool:
    now = datetime.utcnow().timestamp()
    bucket = _rate_buckets.setdefault(client_ip, [])
    # Prune old entries
    bucket[:] = [t for t in bucket if now - t < RATE_LIMIT_WINDOW]
    if len(bucket) >= RATE_LIMIT_MAX:
        return False
    bucket.append(now)
    return True


# ── Startup ──────────────────────────────────────────────────────
@app.on_event("startup")
async def startup_event():
    init_db()
    # Seed assets table
    from database import SessionLocal
    db = SessionLocal()
    try:
        seed_assets(db)
    finally:
        db.close()
    logger.info("Redis available: %s", REDIS_AVAILABLE)


# ── Pydantic Schemas ─────────────────────────────────────────────

class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str
    full_name: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = "user"

class UserLogin(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class User(BaseModel):
    username: str
    email: str
    full_name: Optional[str] = None
    phone: Optional[str] = None
    role: str
    is_active: bool

class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    username: Optional[str] = None
    full_name: Optional[str] = None
    phone: Optional[str] = None
    password: Optional[str] = None

class PreferenceIn(BaseModel):
    background_color: Optional[str] = None
    up_color: Optional[str] = None
    down_color: Optional[str] = None
    up_border_color: Optional[str] = None
    down_border_color: Optional[str] = None
    shell_color: Optional[str] = None
    default_interval: Optional[str] = None
    default_fiat: Optional[str] = None


# ── Portfolio Schemas ────────────────────────────────────────────
class DepositRequest(BaseModel):
    amount_try: Optional[float] = None
    amount_usd: Optional[float] = None
    currency: str = "TRY"   # "TRY" or "USD"
    transaction_date: Optional[str] = None  # ISO format YYYY-MM-DD

class WithdrawRequest(BaseModel):
    amount_usd: Optional[float] = None
    amount_try: Optional[float] = None
    currency: str = "USD"   # "USD" or "TRY"
    transaction_date: Optional[str] = None  # ISO format YYYY-MM-DD

class BuyRequest(BaseModel):
    symbol: str
    quantity: Optional[float] = None
    amount_usd: Optional[float] = None  # For non-BIST assets
    amount_try: Optional[float] = None  # For BIST assets
    transaction_date: Optional[str] = None  # ISO format YYYY-MM-DD
    custom_price: Optional[float] = None  # USD for non-BIST, TRY for BIST
    portfolio_id: Optional[int] = None

class SellRequest(BaseModel):
    symbol: str
    quantity: Optional[float] = None
    amount_usd: Optional[float] = None  # For non-BIST assets
    amount_try: Optional[float] = None  # For BIST assets
    transaction_date: Optional[str] = None  # ISO format YYYY-MM-DD
    custom_price: Optional[float] = None  # USD for non-BIST, TRY for BIST
    portfolio_id: Optional[int] = None

class InterestInRequest(BaseModel):
    amount: float
    currency: str = "USD"   # "USD" or "TRY"
    annual_rate: float
    start_date: str  # ISO format YYYY-MM-DD
    end_date: str    # ISO format YYYY-MM-DD
    payment_interval: str = 'end'  # 'daily', 'weekly', 'monthly', or 'end'

class InterestOutRequest(BaseModel):
    amount: float
    earned: float
    currency: str = "USD"   # "USD" or "TRY"

class ExchangeRequest(BaseModel):
    amount_try: float
    rate: float        # USD/TRY exchange rate (e.g. 34.5)
    direction: str     # "buy_usd" or "sell_usd"
    transaction_date: Optional[str] = None  # ISO format YYYY-MM-DD
    portfolio_id: Optional[int] = None

class PortfolioCreateReq(BaseModel):
    name: str

class PortfolioRenameReq(BaseModel):
    name: str


# ── Helpers ──────────────────────────────────────────────────────
def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))

def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=15))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_user_by_username(db: Session, username: str):
    return db.query(DBUser).filter(DBUser.username == username).first()

def get_user_by_email(db: Session, email: str):
    return db.query(DBUser).filter(DBUser.email == email).first()

def _decode_token(token: str) -> dict:
    """Decode JWT and return payload. Raises HTTPException on failure."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if not payload.get("sub"):
            raise HTTPException(status_code=401, detail="Invalid token")
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Could not validate credentials")

def _require_admin(token: str = Depends(oauth2_scheme)) -> dict:
    payload = _decode_token(token)
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return payload

def _to_user(db_user: DBUser) -> User:
    return User(
        username=db_user.username, email=db_user.email,
        full_name=db_user.full_name, phone=db_user.phone,
        role=db_user.role, is_active=db_user.is_active,
    )


# ═══════════════════════════════════════════════════════════════
#  AUTH ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@app.post("/api/signup", response_model=Token)
async def signup(user: UserCreate, db: Session = Depends(get_db)):
    if get_user_by_username(db, user.username):
        raise HTTPException(status_code=400, detail="Username already registered")
    if get_user_by_email(db, user.email):
        raise HTTPException(status_code=400, detail="Email already registered")

    if user.role not in ("admin", "user"):
        user.role = "user"

    if user.role == "admin":
        existing_admin = db.query(DBUser).filter(DBUser.role == "admin").first()
        if existing_admin:
            raise HTTPException(status_code=403, detail="Admin already exists. Only one admin is allowed.")

    db_user = DBUser(
        email=user.email, username=user.username,
        full_name=user.full_name, phone=user.phone,
        hashed_password=get_password_hash(user.password),
        role=user.role,
    )
    try:
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not create user: {e}")

    access_token = create_access_token(
        data={"sub": user.username, "role": user.role},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": access_token, "token_type": "bearer"}


@app.post("/api/login", response_model=Token)
async def login(user: UserLogin, db: Session = Depends(get_db)):
    db_user = get_user_by_username(db, user.username)
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    if not db_user.is_active:
        raise HTTPException(status_code=403, detail="User account is inactive")
    access_token = create_access_token(
        data={"sub": user.username, "role": db_user.role},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": access_token, "token_type": "bearer"}


@app.post("/api/login/admin", response_model=Token)
async def login_admin(user: UserLogin, db: Session = Depends(get_db)):
    db_user = get_user_by_username(db, user.username)
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    if db_user.role != "admin":
        raise HTTPException(status_code=403, detail="This account is not an admin account")
    if not db_user.is_active:
        raise HTTPException(status_code=403, detail="User account is inactive")
    access_token = create_access_token(
        data={"sub": user.username, "role": db_user.role},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": access_token, "token_type": "bearer"}


@app.post("/api/login/user", response_model=Token)
async def login_user(user: UserLogin, db: Session = Depends(get_db)):
    db_user = get_user_by_username(db, user.username)
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    if db_user.role != "user":
        raise HTTPException(status_code=403, detail="This is an admin account, please use admin login")
    if not db_user.is_active:
        raise HTTPException(status_code=403, detail="User account is inactive")
    access_token = create_access_token(
        data={"sub": user.username, "role": db_user.role},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": access_token, "token_type": "bearer"}


@app.get("/api/me", response_model=User)
async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = _decode_token(token)
    db_user = get_user_by_username(db, payload["sub"])
    if not db_user:
        raise HTTPException(status_code=401, detail="User not found")
    return _to_user(db_user)


@app.get("/")
async def root():
    return {"message": "Investment Return Rate API v2.0"}


# ═══════════════════════════════════════════════════════════════
#  ADMIN ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@app.get("/api/users")
async def get_users(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    payload = _decode_token(token)
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can view all users")
    users = db.query(DBUser).all()
    return [_to_user(u) for u in users]


@app.delete("/api/users/{username}")
async def deactivate_user(
    username: str,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    payload = _decode_token(token)
    if payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    db_user = get_user_by_username(db, username)
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    db_user.is_active = False
    db.commit()
    return {"status": "deactivated", "username": username}


# ═══════════════════════════════════════════════════════════════
#  PROFILE ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@app.put("/api/profile", response_model=User)
async def update_profile(
    user_update: UserUpdate,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    payload = _decode_token(token)
    db_user = get_user_by_username(db, payload["sub"])
    if not db_user:
        raise HTTPException(status_code=401, detail="User not found")

    if user_update.email and user_update.email != db_user.email:
        if get_user_by_email(db, user_update.email):
            raise HTTPException(status_code=400, detail="Email already registered")
        db_user.email = user_update.email

    if user_update.username and user_update.username != db_user.username:
        raise HTTPException(status_code=400, detail="Username cannot be changed")

    if user_update.full_name is not None:
        db_user.full_name = user_update.full_name
    if user_update.phone is not None:
        db_user.phone = user_update.phone
    if user_update.password:
        db_user.hashed_password = get_password_hash(user_update.password)

    try:
        db.commit()
        db.refresh(db_user)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not update profile: {e}")

    return _to_user(db_user)


# ═══════════════════════════════════════════════════════════════
#  USER PREFERENCES ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@app.get("/api/users/{username}/preferences")
async def get_preferences(
    username: str,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    payload = _decode_token(token)
    if payload["sub"] != username and payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied")

    pref = db.query(UserPreference).filter(UserPreference.username == username).first()
    if not pref:
        return {
            "username": username,
            "background_color": "#131722", "up_color": "#26a69a",
            "down_color": "#ef5350", "up_border_color": "#26a69a",
            "down_border_color": "#ef5350", "shell_color": "#1e222d",
            "default_interval": "1d", "default_fiat": "USD",
        }

    return {
        "username": pref.username,
        "background_color": pref.background_color,
        "up_color": pref.up_color,
        "down_color": pref.down_color,
        "up_border_color": pref.up_border_color,
        "down_border_color": pref.down_border_color,
        "shell_color": pref.shell_color,
        "default_interval": pref.default_interval,
        "default_fiat": pref.default_fiat,
    }


@app.post("/api/users/{username}/preferences")
async def save_preferences(
    username: str,
    prefs: PreferenceIn,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    payload = _decode_token(token)
    if payload["sub"] != username and payload.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied")

    db_pref = db.query(UserPreference).filter(UserPreference.username == username).first()
    if not db_pref:
        db_pref = UserPreference(username=username)
        db.add(db_pref)

    for field, value in prefs.dict(exclude_unset=True).items():
        if value is not None:
            setattr(db_pref, field, value)

    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

    return {"status": "saved", "username": username}


# ═══════════════════════════════════════════════════════════════
#  MARKET DATA ENDPOINTS (new canonical + legacy compat)
# ═══════════════════════════════════════════════════════════════

@app.get("/api/markets/list")
async def list_assets(
    group: str = Query(..., regex="^(bist100|sp50|sp500|crypto|commodities|commodity|forex)$"),
):
    """List all assets for a given group."""
    result = market_service.list_assets(group)
    if not result:
        raise HTTPException(status_code=400, detail=f"Unknown group: {group}")
    return result


@app.get("/api/markets/{symbol}/candles")
async def get_candles(
    request: Request,
    symbol: str,
    interval: str = Query("1d", regex="^(5m|15m|1h|4h|1d|1w|1mo)$"),
    start: Optional[str] = None,
    end: Optional[str] = None,
    fiat: str = Query("USD", regex="^(USD|TRY)$"),
):
    """
    Fetch OHLCV candles for a symbol with Redis caching.
    Falls back to Yahoo Finance → CoinGecko → mock data.
    """
    # Rate limit
    client_ip = request.client.host if request.client else "unknown"
    if not _check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again later.")

    cache_key = f"candles:{symbol}:{interval}:{fiat}"

    # Check Redis cache
    if REDIS_AVAILABLE and redis_client:
        try:
            cached = redis_client.get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception:
            pass

    # Fetch from providers
    result = market_service.fetch_candles(
        symbol=symbol, interval=interval,
        start=start, end=end, fiat=fiat,
    )
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    # Store in Redis
    if REDIS_AVAILABLE and redis_client:
        try:
            ttl = CACHE_TTL.get(interval, 60)
            redis_client.setex(cache_key, ttl, json.dumps(result))
        except Exception:
            pass

    return result


@app.get("/api/markets/{symbol}/price")
async def get_price(symbol: str):
    """Get latest price snapshot for a symbol."""
    data = get_live_price(symbol)
    if "error" in data:
        raise HTTPException(status_code=404, detail=data["error"])
    return data


# ── Legacy endpoints (backward compat with frontend) ─────────
@app.get("/api/market/{symbol}")
async def get_asset_data_legacy(
    symbol: str, period: str = "1mo", interval: str = "1d", currency: str = "USD",
):
    from market_data import get_market_data
    data = get_market_data(symbol, period, interval, currency)
    if "error" in data:
        raise HTTPException(status_code=404, detail=data["error"])
    return data


@app.get("/api/market/category/{category}")
async def get_category_market_data_legacy(
    category: str, currency: str = "USD", period: str = "1mo", interval: str = "1d",
):
    valid = ["crypto", "commodity", "sp500", "bist100", "commodities", "sp50", "forex"]
    if category not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid category. Must be one of: {', '.join(valid)}")
    from market_data import get_category_data
    return get_category_data(category, currency, period, interval)


@app.get("/api/market/live/{symbol}")
async def get_live_asset_price_legacy(symbol: str):
    data = get_live_price(symbol)
    if "error" in data:
        raise HTTPException(status_code=404, detail=data["error"])
    return data


# ═══════════════════════════════════════════════════════════════
#  PORTFOLIO ENDPOINTS
# ═══════════════════════════════════════════════════════════════

def _get_current_username(token: str = Depends(oauth2_scheme)) -> str:
    """Extract username from JWT token."""
    payload = _decode_token(token)
    return payload["sub"]


# ── Portfolio CRUD ───────────────────────────────────────────────

@app.get("/api/portfolios")
async def list_portfolios(
    username: str = Depends(_get_current_username),
    db: Session = Depends(get_db),
):
    """List all portfolios for the current user."""
    return portfolio_service.list_portfolios(db, username)


@app.post("/api/portfolios")
async def create_portfolio(
    req: PortfolioCreateReq,
    username: str = Depends(_get_current_username),
    db: Session = Depends(get_db),
):
    """Create a new portfolio."""
    if not req.name or not req.name.strip():
        raise HTTPException(status_code=400, detail="Portfolio name is required")
    result = portfolio_service.create_portfolio(db, username, req.name.strip())
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.put("/api/portfolios/{portfolio_id}")
async def rename_portfolio(
    portfolio_id: int,
    req: PortfolioRenameReq,
    username: str = Depends(_get_current_username),
    db: Session = Depends(get_db),
):
    """Rename a portfolio."""
    if not req.name or not req.name.strip():
        raise HTTPException(status_code=400, detail="Portfolio name is required")
    result = portfolio_service.rename_portfolio(db, username, portfolio_id, req.name.strip())
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.delete("/api/portfolios/{portfolio_id}")
async def delete_portfolio(
    portfolio_id: int,
    username: str = Depends(_get_current_username),
    db: Session = Depends(get_db),
):
    """Delete a portfolio (cannot delete the last one)."""
    result = portfolio_service.delete_portfolio(db, username, portfolio_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


# ── Portfolio Actions ────────────────────────────────────────────

@app.get("/api/portfolio")
async def get_portfolio(
    portfolio_id: Optional[int] = None,
    username: str = Depends(_get_current_username),
    db: Session = Depends(get_db),
):
    """Full portfolio summary with balances, holdings, and P&L."""
    return portfolio_service.get_portfolio_summary(db, username, portfolio_id)


@app.post("/api/portfolio/deposit")
async def portfolio_deposit(
    req: DepositRequest,
    portfolio_id: Optional[int] = None,
    username: str = Depends(_get_current_username),
    db: Session = Depends(get_db),
):
    """Deposit TRY or USD into portfolio."""
    if req.currency == "USD":
        amt = req.amount_usd or 0
        if amt <= 0:
            raise HTTPException(status_code=400, detail="Amount must be positive")
        result = portfolio_service.deposit_usd(db, username, amt, req.transaction_date, portfolio_id)
    else:
        amt = req.amount_try or 0
        if amt <= 0:
            raise HTTPException(status_code=400, detail="Amount must be positive")
        result = portfolio_service.deposit(db, username, amt, req.transaction_date, portfolio_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/api/portfolio/withdraw")
async def portfolio_withdraw(
    req: WithdrawRequest,
    portfolio_id: Optional[int] = None,
    username: str = Depends(_get_current_username),
    db: Session = Depends(get_db),
):
    """Withdraw USD or TRY from cash balance."""
    if req.currency == "TRY":
        amt = req.amount_try or 0
        if amt <= 0:
            raise HTTPException(status_code=400, detail="Amount must be positive")
        # Pre-validate timeline
        p = portfolio_service.get_or_create_portfolio(db, username, portfolio_id)
        vr = portfolio_service.pre_validate_new_transaction(db, p.id, {
            "tx_type": "withdraw", "amount_try": amt,
            "note": f"Withdrew ₺{amt} TRY",
            "transaction_date": req.transaction_date,
        })
        if not vr["valid"]:
            raise HTTPException(status_code=400, detail=vr["error"])
        result = portfolio_service.withdraw_try(db, username, amt, req.transaction_date, portfolio_id)
    else:
        amt = req.amount_usd or 0
        if amt <= 0:
            raise HTTPException(status_code=400, detail="Amount must be positive")
        p = portfolio_service.get_or_create_portfolio(db, username, portfolio_id)
        vr = portfolio_service.pre_validate_new_transaction(db, p.id, {
            "tx_type": "withdraw", "amount_usd": amt,
            "note": f"Withdrew ${amt}",
            "transaction_date": req.transaction_date,
        })
        if not vr["valid"]:
            raise HTTPException(status_code=400, detail=vr["error"])
        result = portfolio_service.withdraw(db, username, amt, req.transaction_date, portfolio_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/api/portfolio/buy")
async def portfolio_buy(
    req: BuyRequest,
    username: str = Depends(_get_current_username),
    db: Session = Depends(get_db),
):
    """Buy an asset. BIST (.IS) → TRY, others → USD."""
    is_bist = req.symbol.endswith('.IS')
    if is_bist:
        if not req.quantity and not req.amount_try:
            raise HTTPException(status_code=400, detail="BIST hisse alımı için quantity veya amount_try belirtiniz")
        if req.amount_try and req.amount_try <= 0:
            raise HTTPException(status_code=400, detail="Amount must be positive")
    else:
        if not req.quantity and not req.amount_usd:
            raise HTTPException(status_code=400, detail="Either quantity or amount_usd must be specified")
        if req.amount_usd and req.amount_usd <= 0:
            raise HTTPException(status_code=400, detail="Amount must be positive")
    if req.quantity and req.quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be positive")
    # Pre-validate timeline
    p = portfolio_service.get_or_create_portfolio(db, username, req.portfolio_id)
    price = req.custom_price or 0
    if price > 0:
        qty = req.quantity or (req.amount_try / price if is_bist and req.amount_try else req.amount_usd / price if req.amount_usd else 0)
        cost_try = req.amount_try or (req.quantity * price if is_bist and req.quantity else 0)
        cost_usd = req.amount_usd or (req.quantity * price if not is_bist and req.quantity else 0)
        note = f"Bought {qty:.4f} {req.symbol} @ {'₺' if is_bist else '$'}{price}"
        vr = portfolio_service.pre_validate_new_transaction(db, p.id, {
            "tx_type": "buy", "symbol": req.symbol, "quantity": qty,
            "amount_try": cost_try, "amount_usd": cost_usd,
            "trade_currency": "TRY" if is_bist else "USD",
            "note": note, "transaction_date": req.transaction_date,
        })
        if not vr["valid"]:
            raise HTTPException(status_code=400, detail=vr["error"])
    result = portfolio_service.buy_asset(
        db, username, req.symbol, req.quantity, req.amount_usd,
        req.transaction_date, req.custom_price,
        portfolio_id=req.portfolio_id, amount_try=req.amount_try,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/api/portfolio/sell")
async def portfolio_sell(
    req: SellRequest,
    username: str = Depends(_get_current_username),
    db: Session = Depends(get_db),
):
    """Sell an asset. BIST (.IS) → TRY, others → USD."""
    is_bist = req.symbol.endswith('.IS')
    if is_bist:
        if not req.quantity and not req.amount_try:
            raise HTTPException(status_code=400, detail="BIST hisse satışı için quantity veya amount_try belirtiniz")
        if req.amount_try and req.amount_try <= 0:
            raise HTTPException(status_code=400, detail="Amount must be positive")
    else:
        if not req.quantity and not req.amount_usd:
            raise HTTPException(status_code=400, detail="Either quantity or amount_usd must be specified")
        if req.amount_usd and req.amount_usd <= 0:
            raise HTTPException(status_code=400, detail="Amount must be positive")
    if req.quantity and req.quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be positive")
    # Pre-validate timeline
    p = portfolio_service.get_or_create_portfolio(db, username, req.portfolio_id)
    price = req.custom_price or 0
    if price > 0:
        qty = req.quantity or (req.amount_try / price if is_bist and req.amount_try else req.amount_usd / price if req.amount_usd else 0)
        proceeds_try = req.amount_try or (req.quantity * price if is_bist and req.quantity else 0)
        proceeds_usd = req.amount_usd or (req.quantity * price if not is_bist and req.quantity else 0)
        note = f"Sold {qty:.4f} {req.symbol} @ {'₺' if is_bist else '$'}{price}"
        vr = portfolio_service.pre_validate_new_transaction(db, p.id, {
            "tx_type": "sell", "symbol": req.symbol, "quantity": qty,
            "amount_try": proceeds_try, "amount_usd": proceeds_usd,
            "trade_currency": "TRY" if is_bist else "USD",
            "note": note, "transaction_date": req.transaction_date,
        })
        if not vr["valid"]:
            raise HTTPException(status_code=400, detail=vr["error"])
    result = portfolio_service.sell_asset(
        db, username, req.symbol, req.quantity, req.amount_usd,
        req.transaction_date, req.custom_price,
        portfolio_id=req.portfolio_id, amount_try=req.amount_try,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/api/portfolio/interest/in")
async def portfolio_interest_in(
    req: InterestInRequest,
    portfolio_id: Optional[int] = None,
    username: str = Depends(_get_current_username),
    db: Session = Depends(get_db),
):
    """Move cash into an interest-bearing deposit (USD or TRY)."""
    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")
    if req.annual_rate <= 0:
        raise HTTPException(status_code=400, detail="Rate must be positive")
    
    # Pre-validate timeline
    p = portfolio_service.get_or_create_portfolio(db, username, portfolio_id)
    if req.currency == "TRY":
        vr = portfolio_service.pre_validate_new_transaction(db, p.id, {
            "tx_type": "interest_in", "amount_try": req.amount,
            "note": f"Interest deposit ₺{req.amount} TRY",
            "transaction_date": req.start_date,
        })
    else:
        vr = portfolio_service.pre_validate_new_transaction(db, p.id, {
            "tx_type": "interest_in", "amount_usd": req.amount,
            "note": f"Interest deposit ${req.amount}",
            "transaction_date": req.start_date,
        })
    if not vr["valid"]:
        raise HTTPException(status_code=400, detail=vr["error"])

    if req.currency == "TRY":
        result = portfolio_service.interest_in_try(
            db, username, req.amount, req.annual_rate, 
            req.start_date, req.end_date, req.payment_interval,
            portfolio_id=portfolio_id,
        )
    else:
        result = portfolio_service.interest_in(
            db, username, req.amount, req.annual_rate,
            req.start_date, req.end_date, req.payment_interval,
            portfolio_id=portfolio_id,
        )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/api/portfolio/interest/out")
async def portfolio_interest_out(
    req: InterestOutRequest,
    portfolio_id: Optional[int] = None,
    username: str = Depends(_get_current_username),
    db: Session = Depends(get_db),
):
    """Withdraw interest deposit back to cash (principal + earned interest)."""
    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    if req.currency == "TRY":
        result = portfolio_service.interest_out_try(db, username, req.amount, req.earned, portfolio_id)
    else:
        result = portfolio_service.interest_out(db, username, req.amount, req.earned, portfolio_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/api/portfolio/exchange")
async def portfolio_exchange(
    req: ExchangeRequest,
    username: str = Depends(_get_current_username),
    db: Session = Depends(get_db),
):
    """Exchange between TRY and USD. User specifies TRY amount and rate."""
    if req.amount_try <= 0:
        raise HTTPException(status_code=400, detail="TRY amount must be positive")
    if req.rate <= 0:
        raise HTTPException(status_code=400, detail="Rate must be positive")
    if req.direction not in ("buy_usd", "sell_usd"):
        raise HTTPException(status_code=400, detail="Direction must be 'buy_usd' or 'sell_usd'")
    # Pre-validate timeline
    p = portfolio_service.get_or_create_portfolio(db, username, req.portfolio_id)
    amount_usd = round(req.amount_try / req.rate, 4)
    if req.direction == "buy_usd":
        vr = portfolio_service.pre_validate_new_transaction(db, p.id, {
            "tx_type": "exchange", "amount_try": req.amount_try, "amount_usd": amount_usd,
            "note": f"Bought ${amount_usd} for ₺{req.amount_try}",
            "transaction_date": req.transaction_date,
        })
    else:
        vr = portfolio_service.pre_validate_new_transaction(db, p.id, {
            "tx_type": "exchange", "amount_try": req.amount_try, "amount_usd": amount_usd,
            "note": f"Sold ${amount_usd} for ₺{req.amount_try}",
            "transaction_date": req.transaction_date,
        })
    if not vr["valid"]:
        raise HTTPException(status_code=400, detail=vr["error"])
    result = portfolio_service.exchange_currency(
        db, username, req.amount_try, req.rate, req.direction, 
        req.transaction_date, portfolio_id=req.portfolio_id,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.get("/api/portfolio/bank-rates")
async def get_bank_rates():
    """Get current bank FX buy/sell rates for USD/TRY."""
    return portfolio_service.get_bank_fx_rates()


@app.get("/api/portfolio/pnl")
async def portfolio_pnl(
    period: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    portfolio_id: Optional[int] = None,
    symbols: Optional[str] = None,
    username: str = Depends(_get_current_username),
    db: Session = Depends(get_db),
):
    """Calculate PnL for a given period (1m, 3m, 1y, 5y, all, or custom dates)."""
    symbol_list = [s.strip() for s in symbols.split(',')] if symbols else None
    result = portfolio_service.calculate_period_pnl(
        db, username, period=period,
        start_date_str=start_date, end_date_str=end_date,
        portfolio_id=portfolio_id, symbols=symbol_list,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.get("/api/markets/search")
async def search_assets(q: str = Query(..., min_length=1)):
    """Search assets by name or symbol code."""
    from market_data import ASSET_NAMES, GROUP_MAP
    q_lower = q.lower()
    results = []
    for symbol, name in ASSET_NAMES.items():
        if q_lower in symbol.lower() or q_lower in name.lower():
            group = "unknown"
            for grp, symbols in GROUP_MAP.items():
                if symbol in symbols:
                    group = grp
                    break
            results.append({
                "symbol": symbol,
                "name": name,
                "group": group,
            })
    return results[:20]


@app.get("/api/portfolio/transactions")
async def portfolio_transactions(
    limit: int = Query(50, ge=1, le=500),
    portfolio_id: Optional[int] = None,
    username: str = Depends(_get_current_username),
    db: Session = Depends(get_db),
):
    """Get transaction history."""
    return portfolio_service.get_transactions(db, username, limit, portfolio_id)


@app.delete("/api/portfolio/transactions/{tx_id}")
async def delete_transaction(
    tx_id: int,
    portfolio_id: Optional[int] = None,
    username: str = Depends(_get_current_username),
    db: Session = Depends(get_db),
):
    """
    Delete a transaction after validating timeline integrity.
    Returns error if deletion would cause negative balances.
    """
    result = portfolio_service.delete_transaction(db, username, tx_id, portfolio_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


# ═══════════════════════════════════════════════════════════════
#  WEBSOCKET — Live Price Stream
# ═══════════════════════════════════════════════════════════════

@app.websocket("/ws/prices")
async def ws_prices(websocket: WebSocket):
    """
    WebSocket endpoint for live price streaming.
    Client sends: {"symbols": ["AAPL", "BTC-USD"]}
    Server pushes price updates every 5 seconds.
    """
    await websocket.accept()
    symbols: List[str] = []
    try:
        # Wait for initial message with symbol list
        data = await asyncio.wait_for(websocket.receive_json(), timeout=10)
        symbols = data.get("symbols", [])[:20]  # Cap at 20 symbols
        if not symbols:
            await websocket.send_json({"error": "No symbols provided"})
            await websocket.close()
            return

        while True:
            prices = []
            for sym in symbols:
                price_data = get_live_price(sym)
                if "error" not in price_data:
                    prices.append(price_data)
            await websocket.send_json({"prices": prices, "timestamp": int(datetime.utcnow().timestamp())})
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except asyncio.TimeoutError:
        await websocket.close(code=1008, reason="Timeout waiting for symbols")
    except Exception as e:
        logger.warning("WebSocket error: %s", e)
        try:
            await websocket.close()
        except Exception:
            pass
