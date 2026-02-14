from sqlalchemy import (
    create_engine, Column, Integer, String, DateTime, Boolean,
    BigInteger, DECIMAL, UniqueConstraint, Index, ForeignKey,
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from datetime import datetime
import os
import enum
import logging

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "mysql+pymysql://investment_user:investment_pass@localhost:3306/investment_db",
)

engine = create_engine(DATABASE_URL, echo=False, pool_pre_ping=True, pool_recycle=3600)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# ── Enums ────────────────────────────────────────────────────────
class UserRole(str, enum.Enum):
    ADMIN = "admin"
    USER = "user"


# ── Models ───────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    username = Column(String(255), primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    full_name = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=True)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(20), default="user", nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    preferences = relationship(
        "UserPreference", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )


class UserPreference(Base):
    __tablename__ = "user_preferences"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(
        String(255),
        ForeignKey("users.username", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    background_color = Column(String(9), default="#131722")
    up_color = Column(String(9), default="#26a69a")
    down_color = Column(String(9), default="#ef5350")
    up_border_color = Column(String(9), default="#26a69a")
    down_border_color = Column(String(9), default="#ef5350")
    shell_color = Column(String(9), default="#1e222d")
    default_interval = Column(String(5), default="1d")
    default_fiat = Column(String(3), default="USD")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="preferences")


class Asset(Base):
    __tablename__ = "assets"

    symbol = Column(String(30), primary_key=True)
    name = Column(String(255), nullable=False)
    asset_group = Column(String(20), nullable=False)
    base_currency = Column(String(5), default="USD")
    is_active = Column(Boolean, default=True)
    yahoo_symbol = Column(String(30), nullable=True)
    coingecko_id = Column(String(50), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class DataProvider(Base):
    __tablename__ = "data_providers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(50), unique=True, nullable=False)
    base_url = Column(String(255), nullable=True)
    api_key_env = Column(String(50), nullable=True)
    priority = Column(Integer, default=0)
    rate_limit_rpm = Column(Integer, default=60)
    is_active = Column(Boolean, default=True)


class CachedCandle(Base):
    __tablename__ = "cached_candles"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    symbol = Column(String(30), nullable=False)
    interval_tf = Column(String(5), nullable=False)
    currency = Column(String(5), default="USD")
    candle_time = Column(Integer, nullable=False)
    open_p = Column(DECIMAL(18, 8), nullable=True)
    high_p = Column(DECIMAL(18, 8), nullable=True)
    low_p = Column(DECIMAL(18, 8), nullable=True)
    close_p = Column(DECIMAL(18, 8), nullable=True)
    volume = Column(BigInteger, nullable=True)
    fetched_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("symbol", "interval_tf", "currency", "candle_time", name="ux_candle"),
        Index("ix_sym_interval", "symbol", "interval_tf"),
    )


# ── DB helpers ───────────────────────────────────────────────────
def _migrate_columns():
    """Add any columns that exist in the models but not yet in the DB."""
    from sqlalchemy import inspect as sa_inspect, text

    inspector = sa_inspect(engine)
    model_tables = {
        "users": User,
        "user_preferences": UserPreference,
        "assets": Asset,
        "data_providers": DataProvider,
        "cached_candles": CachedCandle,
    }
    for table_name, model_cls in model_tables.items():
        if not inspector.has_table(table_name):
            continue
        existing_cols = {c["name"] for c in inspector.get_columns(table_name)}
        for col in model_cls.__table__.columns:
            if col.name not in existing_cols:
                col_type = col.type.compile(engine.dialect)
                nullable = "NULL" if col.nullable else "NOT NULL"
                default = ""
                if col.default is not None:
                    dv = col.default.arg
                    if callable(dv):
                        default = ""
                    elif isinstance(dv, str):
                        default = f" DEFAULT '{dv}'"
                    else:
                        default = f" DEFAULT {dv}"
                sql = f"ALTER TABLE `{table_name}` ADD COLUMN `{col.name}` {col_type} {nullable}{default}"
                try:
                    with engine.connect() as conn:
                        conn.execute(text(sql))
                        conn.commit()
                except Exception as exc:
                    logger.warning("Migration skip %s.%s: %s", table_name, col.name, exc)


def init_db():
    Base.metadata.create_all(bind=engine)
    _migrate_columns()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def seed_assets(db):
    """Seed the assets table with known symbols if empty."""
    from market_data import ASSET_REGISTRY

    existing = db.query(Asset).count()
    if existing > 0:
        return

    for item in ASSET_REGISTRY:
        asset = Asset(
            symbol=item["symbol"],
            name=item["name"],
            asset_group=item["group"],
            base_currency=item.get("base_currency", "USD"),
            yahoo_symbol=item.get("yahoo_symbol"),
            coingecko_id=item.get("coingecko_id"),
        )
        db.add(asset)

    try:
        db.commit()
    except Exception:
        db.rollback()
