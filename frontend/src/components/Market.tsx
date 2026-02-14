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

const Market: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [category, setCategory] = useState<string>('crypto');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [currency, setCurrency] = useState<string>('USD');
  const [timeframe, setTimeframe] = useState<string>('1d');

  const timeframes = [
    { id: '5m', label: '5m', period: '1d', interval: '5m' },
    { id: '15m', label: '15m', period: '5d', interval: '15m' },
    { id: '1h', label: '1h', period: '1mo', interval: '1h' },
    { id: '4h', label: '4h', period: '3mo', interval: '4h' },
    { id: '1d', label: '1D', period: '1mo', interval: '1d' },
    { id: '1w', label: '1W', period: '6mo', interval: '1wk' },
    { id: '1mo', label: '1M', period: '1y', interval: '1mo' },
  ];

  useEffect(() => {
    fetchCategoryData(category);
  }, [category, currency, timeframe]);

  const fetchCategoryData = async (cat: string) => {
    setLoading(true);
    try {
      const selectedTimeframe = timeframes.find(tf => tf.id === timeframe);
      const response = await axios.get(`${API_URL}/api/market/category/${cat}`, {
        params: { 
          currency: currency,
          period: selectedTimeframe?.period || '1mo',
          interval: selectedTimeframe?.interval || '1d'
        }
      });
      setAssets(response.data);
      if (response.data.length > 0) {
        setSelectedAsset(response.data[0]);
      }
    } catch (error) {
      console.error('Failed to fetch market data:', error);
    } finally {
      setLoading(false);
    }
  };

  const categories = [
    { id: 'crypto', label: 'Cryptocurrency', icon: '₿' },
    { id: 'commodity', label: 'Commodities', icon: '🏆' },
    { id: 'bist100', label: 'BIST 100', icon: '🇹🇷' },
    { id: 'sp500', label: 'S&P 500', icon: '🇺🇸' },
  ];

  return (
    <div className="market-container">
      <header className="market-header">
        <div className="header-content">
          <h1>QUANT DASHBOARD v2.0 🚀</h1>
          <div className="header-actions">
            <button className="btn-settings" onClick={() => setShowSettings(true)}>
              ⚙️ Chart Settings
            </button>
            {user && (
              <>
                <button className="btn-profile" onClick={() => navigate('/profile')}>
                  👤 {user.username}
                </button>
                <button className="btn-logout" onClick={logout}>
                  Logout
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="market-content">
        <nav className="category-nav">
          {categories.map((cat) => (
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
              <h3>🔥 Live Markets</h3>
              <span className="asset-count">{assets.length}</span>
            </div>
            {loading ? (
              <div className="loading">Loading...</div>
            ) : (
              <div className="assets-list">
                {assets.map((asset) => (
                  <div
                    key={asset.symbol}
                    className={`asset-item ${selectedAsset?.symbol === asset.symbol ? 'selected' : ''}`}
                    onClick={() => setSelectedAsset(asset)}
                  >
                    <div className="asset-info">
                      <div className="asset-name">{asset.name}</div>
                      <div className="asset-symbol">{asset.symbol}</div>
                    </div>
                    <div className="asset-price">
                      <div className="price">{currency === 'TRY' ? '₺' : '$'}{asset.current_price.toLocaleString()}</div>
                      <div className={`change ${asset.price_change >= 0 ? 'positive' : 'negative'}`}>
                        {asset.price_change >= 0 ? '+' : ''}{asset.price_change_percent.toFixed(2)}%
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
                          ({selectedAsset.price_change >= 0 ? '+' : ''}{selectedAsset.price_change_percent.toFixed(2)}%)
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="timeframe-selector">
                    {timeframes.map((tf) => (
                      <button
                        key={tf.id}
                        className={`timeframe-btn ${timeframe === tf.id ? 'active' : ''}`}
                        onClick={() => setTimeframe(tf.id)}
                      >
                        {tf.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="chart-wrapper">
                  <CandlestickChart data={selectedAsset.candles} height={500} />
                </div>
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-state-icon">📈</div>
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
