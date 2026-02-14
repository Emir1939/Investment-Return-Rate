import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import './Dashboard.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

interface MarketPreview {
  symbol: string;
  name: string;
  current_price: number;
  price_change_percent: number;
}

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [marketPreview, setMarketPreview] = useState<MarketPreview[]>([]);
  const [previewLoading, setPreviewLoading] = useState(true);

  useEffect(() => {
    loadPreview();
  }, []);

  const loadPreview = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/market/category/crypto`, {
        params: { currency: 'USD' },
      });
      setMarketPreview(res.data.slice(0, 4));
    } catch (e) {
      console.error(e);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/signin');
  };

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="dash">
      {/* ── Top bar ── */}
      <header className="dash-topbar">
        <div className="dash-topbar-inner">
          <div className="dash-brand">
            <span className="dash-logo">Q</span>
            <span className="dash-brand-text">Quant Dashboard</span>
          </div>
          <nav className="dash-nav">
            <button className="dash-nav-btn active">Dashboard</button>
            <button className="dash-nav-btn" onClick={() => navigate('/market')}>Markets</button>
            <button className="dash-nav-btn" onClick={() => navigate('/profile')}>Profile</button>
          </nav>
          <div className="dash-topbar-right">
            <span className="dash-user-chip">
              {user?.role === 'admin' ? '◆' : '⊙'} {user?.username}
            </span>
            <button className="dash-logout-btn" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="dash-body">
        {/* Welcome */}
        <section className="dash-welcome">
          <div>
            <h1>{greeting}, {user?.username}</h1>
            <p className="dash-subtitle">
              {now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <button className="dash-cta" onClick={() => navigate('/market')}>
            Open Markets →
          </button>
        </section>

        {/* Stats */}
        <div className="dash-stats">
          <div className="dash-stat-card">
            <div className="stat-icon-box">◈</div>
            <div className="stat-content">
              <span className="stat-number">150+</span>
              <span className="stat-desc">Global Assets</span>
            </div>
          </div>
          <div className="dash-stat-card">
            <div className="stat-icon-box">◆</div>
            <div className="stat-content">
              <span className="stat-number">4</span>
              <span className="stat-desc">Market Categories</span>
            </div>
          </div>
          <div className="dash-stat-card">
            <div className="stat-icon-box">◇</div>
            <div className="stat-content">
              <span className="stat-number">7</span>
              <span className="stat-desc">Timeframes</span>
            </div>
          </div>
          <div className="dash-stat-card">
            <div className="stat-icon-box">⊙</div>
            <div className="stat-content">
              <span className="stat-number">{user?.role === 'admin' ? 'Admin' : 'User'}</span>
              <span className="stat-desc">Account Type</span>
            </div>
          </div>
        </div>

        {/* Action cards */}
        <div className="dash-cards">
          <div className="dash-action-card" onClick={() => navigate('/market')}>
            <div className="action-header">
              <span className="action-icon">◈</span>
              <span className="action-arrow">→</span>
            </div>
            <h3>Live Markets</h3>
            <p>Real-time candlestick charts, 150+ assets across BIST-100, S&amp;P 500, Crypto &amp; Commodities</p>
          </div>

          <div className="dash-action-card" onClick={() => navigate('/profile')}>
            <div className="action-header">
              <span className="action-icon">⊙</span>
              <span className="action-arrow">→</span>
            </div>
            <h3>Account &amp; Settings</h3>
            <p>Manage your profile, update chart preferences, and customize your trading experience</p>
          </div>

          {user?.role === 'admin' && (
            <div className="dash-action-card" onClick={() => navigate('/market')}>
              <div className="action-header">
                <span className="action-icon">◆</span>
                <span className="action-arrow">→</span>
              </div>
              <h3>Admin Panel</h3>
              <p>User management, system monitoring, and platform administration tools</p>
            </div>
          )}
        </div>

        {/* Market snapshot */}
        {!previewLoading && marketPreview.length > 0 && (
          <section className="dash-snapshot">
            <div className="snapshot-header">
              <h2>Market Snapshot</h2>
              <button className="snapshot-link" onClick={() => navigate('/market')}>View all →</button>
            </div>
            <div className="snapshot-grid">
              {marketPreview.map((a) => (
                <div key={a.symbol} className="snapshot-card" onClick={() => navigate('/market')}>
                  <div className="snapshot-top">
                    <span className="snapshot-name">{a.name}</span>
                    <span className="snapshot-sym">{a.symbol}</span>
                  </div>
                  <div className="snapshot-bottom">
                    <span className="snapshot-price">${a.current_price.toLocaleString()}</span>
                    <span className={`snapshot-change ${a.price_change_percent >= 0 ? 'positive' : 'negative'}`}>
                      {a.price_change_percent >= 0 ? '+' : ''}{a.price_change_percent.toFixed(2)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Account details */}
        <section className="dash-account">
          <h2>Account Details</h2>
          <div className="account-grid">
            <div className="account-field">
              <span className="field-label">Email</span>
              <span className="field-value">{user?.email}</span>
            </div>
            <div className="account-field">
              <span className="field-label">Username</span>
              <span className="field-value">{user?.username}</span>
            </div>
            <div className="account-field">
              <span className="field-label">Role</span>
              <span className="field-value">{user?.role === 'admin' ? 'Administrator' : 'Regular User'}</span>
            </div>
            <div className="account-field">
              <span className="field-label">Status</span>
              <span className="field-value field-value--active">Active</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Dashboard;
