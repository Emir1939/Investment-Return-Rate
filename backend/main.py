from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, EmailStr
import bcrypt
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional, List
from sqlalchemy.orm import Session
from database import init_db, get_db, User as DBUser, UserRole
from market_data import get_market_data, get_category_data, get_live_price

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:80", "http://frontend:80"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SECRET_KEY = "your-secret-key-here-change-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

@app.on_event("startup")
async def startup_event():
    init_db()

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
    full_name: Optional[str]
    phone: Optional[str]
    role: str
    is_active: bool

class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    username: Optional[str] = None
    full_name: Optional[str] = None
    phone: Optional[str] = None
    password: Optional[str] = None

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def get_user_by_username(db: Session, username: str):
    return db.query(DBUser).filter(DBUser.username == username).first()

def get_user_by_email(db: Session, email: str):
    return db.query(DBUser).filter(DBUser.email == email).first()

@app.post("/api/signup", response_model=Token)
async def signup(user: UserCreate, db: Session = Depends(get_db)):
    if get_user_by_username(db, user.username):
        raise HTTPException(status_code=400, detail="Username already registered")
    if get_user_by_email(db, user.email):
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Validate role
    if user.role not in ["admin", "user"]:
        user.role = "user"
    
    # If registering as admin, check if admin already exists and block registration
    if user.role == "admin":
        existing_admin = db.query(DBUser).filter(DBUser.role == "admin").first()
        if existing_admin:
            raise HTTPException(status_code=403, detail="Admin already exists. Only one admin is allowed.")
    
    hashed_password = get_password_hash(user.password)
    db_user = DBUser(
        email=user.email,
        username=user.username,
        full_name=user.full_name,
        phone=user.phone,
        hashed_password=hashed_password,
        role=user.role
    )
    
    try:
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not create user: {str(e)}")
    
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role}, 
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
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
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
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
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
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
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/me", response_model=User)
async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Could not validate credentials")
    except JWTError:
        raise HTTPException(status_code=401, detail="Could not validate credentials")
    
    db_user = get_user_by_username(db, username)
    if not db_user:
        raise HTTPException(status_code=401, detail="Could not validate credentials")
    
    return User(
        username=db_user.username,
        email=db_user.email,
        full_name=db_user.full_name,
        phone=db_user.phone,
        role=db_user.role,
        is_active=db_user.is_active
    )

@app.get("/")
async def root():
    return {"message": "Welcome to the API"}

@app.get("/api/users")
async def get_users(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        role = payload.get("role")
        if role != "admin":
            raise HTTPException(status_code=403, detail="Only admins can view all users")
    except JWTError:
        raise HTTPException(status_code=401, detail="Could not validate credentials")
    
    users = db.query(DBUser).all()
    return [
        User(
            id=u.id,
            username=u.username,
            email=u.emailme,
            phone=u.phone,
            role=u.role,
            is_active=u.is_active
        )
        for u in users
    ]

@app.put("/api/profile", response_model=User)
async def update_profile(user_update: UserUpdate, token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Could not validate credentials")
    except JWTError:
        raise HTTPException(status_code=401, detail="Could not validate credentials")
    
    db_user = get_user_by_username(db, username)
    if not db_user:
        raise HTTPException(status_code=401, detail="Could not validate credentials")
    
    # Check if new email is taken by another user
    if user_update.email and user_update.email != db_user.email:
        existing = get_user_by_email(db, user_update.email)
        if existing:
            raise HTTPException(status_code=400, detail="Email already registered")
        db_user.email = user_update.email
    
    # Username is primary key, cannot be changed
    if user_update.username and user_update.username != db_user.username:
        raise HTTPException(status_code=400, detail="Username cannot be changed")
    
    # Update other fields
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
        raise HTTPException(status_code=500, detail=f"Could not update profile: {str(e)}")
    
    return User(
        username=db_user.username,
        email=db_user.email,
        full_name=db_user.full_name,
        phone=db_user.phone,
        role=db_user.role,
        is_active=db_user.is_active
    )

# Market Data Endpoints
@app.get("/api/market/{symbol}")
async def get_asset_data(symbol: str, period: str = "1mo", interval: str = "1d", currency: str = "USD"):
    """
    Get market data for a specific symbol
    """
    data = get_market_data(symbol, period, interval, currency)
    if "error" in data:
        raise HTTPException(status_code=404, detail=data["error"])
    return data

@app.get("/api/market/category/{category}")
async def get_category_market_data(category: str, currency: str = "USD", period: str = "1mo", interval: str = "1d"):
    """
    Get market data for all assets in a category
    Categories: crypto, commodity, sp500, bist100
    """
    valid_categories = ["crypto", "commodity", "sp500", "bist100"]
    if category not in valid_categories:
        raise HTTPException(status_code=400, detail=f"Invalid category. Must be one of: {', '.join(valid_categories)}")
    
    data = get_category_data(category, currency, period, interval)
    return data

@app.get("/api/market/live/{symbol}")
async def get_live_asset_price(symbol: str):
    """
    Get live price for a specific symbol
    """
    data = get_live_price(symbol)
    if "error" in data:
        raise HTTPException(status_code=404, detail=data["error"])
    return data

