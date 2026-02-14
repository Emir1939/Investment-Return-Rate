import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import CandlestickChart from './CandlestickChart';
import ChartSettings from './ChartSettings';
import { CandlestickData } from 'lightweight-charts';
import './Market.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

interface Asset {
  symbol: string;
  name: string;
  current_price: number;
  price_change: number;
  price_change_percent: number;
  currency: string;
  candles: CandlestickData[];
}

const TIMEFRAMES = [
  { id: '5m', label: '5m', interval: '5m' },
  { id: '15m', label: '15m', interval: '15m' },
  { id: '1h', label: '1h', interval: '1h' },
  { id: '4h', label: '4h', interval: '4h' },
  { id: '1d', label: '1D', interval: '1d' },
  { id: '1w', label: '1W', interval: '1w' },
  { id: '1mo', label: '1M', interval: '1mo' },
];

const CATEGORIES = [
  { id: 'crypto', label: 'Crypto', icon: '₿' },
  { id: 'commodity', label: 'Commodities', icon: '◆' },
  { id: 'bist100', label: 'BIST 100', icon: '◇' },
  { id: 'sp500', label: 'S&P 500', icon: '◈' },
];

const Market: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [category, setCategory] = useState<string>('crypto');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [currency, setCurrency] = useState<string>('USD');
  const [timeframe, setTimeframe] = useState<string>('1d');

  /* ── Load category prices (fast, no candles) ── */
  useEffect(() => {
    loadCategory();
  }, [category, currency]);

  const loadCategory = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_URL}/api/market/category/${category}`, {
        params: { currency },
      });
      const list: Asset[] = res.data;
      setAssets(list);
      if (list.length > 0) {
        setSelectedAsset(list[0]);
        loadCandles(list[0].symbol, timeframe);
      }
    } catch (e) {
      console.error('Category fetch failed:', e);
    } finally {
      setLoading(false);
    }
  };

  /* ── Load candles for one asset ── */
  const loadCandles = async (symbol: string, tf: string) => {
    setChartLoading(true);
    const interval = TIMEFRAMES.find(t => t.id === tf)?.interval || '1d';
    try {
      const res = await axios.get(`${API_URL}/api/markets/${symbol}/candles`, {
        params: { interval, fiat: currency },
      });
      if (res.data?.candles) {
        setSelectedAsset(prev =>
          prev?.symbol === symbol
            ? {
                ...prev,
                candles: res.data.candles,
                current_price: res.data.current_price ?? prev.current_price,
                price_change: res.data.price_change ?? prev.price_change,
                price_change_percent: res.data.price_change_percent ?? prev.price_change_percent,
              }
            : prev
        );
      }
    } catch (e) {
      console.error('Candle fetch failed:', e);
    } finally {
      setChartLoading(false);
    }
  };

  /* ── Handlers ── */
  const selectAsset = (asset: Asset) => {
    const same = selectedAsset?.symbol === asset.symbol;
    if (!same) setSelectedAsset(asset);
    loadCandles(asset.symbol, timeframe);
  };

  const changeTimeframe = (tf: string) => {
    setTimeframe(tf);
    if (selectedAsset) loadCandles(selectedAsset.symbol, tf);
  };

  const handleLogout = () => {
    logout();
    navigate('/signin');
  };

  return (
    <div className="market-container">
      <header className="market-header">
        <div className="header-content">
          <div className="header-brand">
            <span className="header-logo">Q</span>
            <h1>Quant Dashboard</h1>
          </div>
          <div className="header-actions">
            <button className="btn-settings" onClick={() => setShowSettings(true)}>
              ⚙ Settings
            </button>
            {user && (
              <>
                <button className="btn-profile" onClick={() => navigate('/dashboard')}>
                  ◈ Dashboard
                </button>
                <button className="btn-profile" onClick={() => navigate('/profile')}>
                  ⊙ {user.username}
                </button>
                <button className="btn-logout" onClick={handleLogout}>
                  Logout
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="market-content">
        <nav className="category-nav">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              className={`category-btn ${category === cat.id ? 'active' : ''}`}
              onClick={() => setCategory(cat.id)}
            >
              <span className="category-icon">{cat.icon}</span>
              <span className="category-label">{cat.label}</span>
            </button>
          ))}
        </nav>

        {category === 'bist100' && (
          <div className="currency-toggle">
            <button
              className={`currency-btn ${currency === 'USD' ? 'active' : ''}`}
              onClick={() => setCurrency('USD')}
            >
              USD
            </button>
            <button
              className={`currency-btn ${currency === 'TRY' ? 'active' : ''}`}
              onClick={() => setCurrency('TRY')}
            >
              TRY
            </button>
          </div>
        )}

        <div className="market-layout">
          <aside className="assets-sidebar">
            <div className="sidebar-header">
              <h3>Live Markets</h3>
              <span className="asset-count">{assets.length}</span>
            </div>
            {loading ? (
              <div className="loading">Loading…</div>
            ) : (
              <div className="assets-list">
                {assets.map((asset) => (
                  <div
                    key={asset.symbol}
                    className={`asset-item ${selectedAsset?.symbol === asset.symbol ? 'selected' : ''}`}
                    onClick={() => selectAsset(asset)}
                  >
                    <div className="asset-info">
                      <div className="asset-name">{asset.name}</div>
                      <div className="asset-symbol">{asset.symbol}</div>
                    </div>
                    <div className="asset-price">
                      <div className="price">
                        {currency === 'TRY' ? '₺' : '$'}{asset.current_price.toLocaleString()}
                      </div>
                      <div className={`change ${asset.price_change_percent >= 0 ? 'positive' : 'negative'}`}>
                        {asset.price_change_percent >= 0 ? '+' : ''}{asset.price_change_percent.toFixed(2)}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </aside>

          <main className="chart-main">
            {selectedAsset ? (
              <>
                <div className="chart-header">
                  <div className="asset-details">
                    <h2>{selectedAsset.name}</h2>
                    <span className="asset-symbol-text">{selectedAsset.symbol}</span>
                    <div className="price-info">
                      <span className="current-price">
                        {currency === 'TRY' ? '₺' : '$'}{selectedAsset.current_price.toLocaleString()}
                      </span>
                      <div className={`price-change-info ${selectedAsset.price_change >= 0 ? 'positive' : 'negative'}`}>
                        <span>
                          {selectedAsset.price_change >= 0 ? '+' : ''}
                          {currency === 'TRY' ? '₺' : '$'}{selectedAsset.price_change.toFixed(2)}
                        </span>
                        <span>
                          ({selectedAsset.price_change_percent >= 0 ? '+' : ''}{selectedAsset.price_change_percent.toFixed(2)}%)
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="timeframe-selector">
                    {TIMEFRAMES.map((tf) => (
                      <button
                        key={tf.id}
                        className={`timeframe-btn ${timeframe === tf.id ? 'active' : ''}`}
                        onClick={() => changeTimeframe(tf.id)}
                      >
                        {tf.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="chart-wrapper">
                  {chartLoading ? (
                    <div className="chart-loading">
                      <div className="chart-spinner" />
                      <span>Loading chart…</span>
                    </div>
                  ) : selectedAsset.candles && selectedAsset.candles.length > 0 ? (
                    <CandlestickChart data={selectedAsset.candles} height={500} />
                  ) : (
                    <div className="chart-loading">
                      <span>No chart data available</span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">◈</div>
                <p>Select an asset to view chart</p>
              </div>
            )}
          </main>
        </div>
      </div>

      {showSettings && <ChartSettings onClose={() => setShowSettings(false)} />}
    </div>
  );
};

export default Market;
