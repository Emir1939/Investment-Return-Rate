import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Auth.css';

const SignIn: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { loginUser } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await loginUser(username, password);
      navigate('/market');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      {/* Left brand panel */}
      <div className="auth-brand">
        <div className="brand-content">
          <div className="brand-logo">Q</div>
          <h2 className="brand-title">Quant Dashboard</h2>
          <p className="brand-subtitle">
            Professional-grade market analytics. Real-time candlestick charts, 150+ assets,
            multi-timeframe analysis.
          </p>
          <div className="brand-features">
            <div className="brand-feature">
              <span className="feature-icon">◆</span>
              <span>Real-time Yahoo Finance data</span>
            </div>
            <div className="brand-feature">
              <span className="feature-icon">◆</span>
              <span>BIST-100, S&P 500, Crypto, Commodities</span>
            </div>
            <div className="brand-feature">
              <span className="feature-icon">◆</span>
              <span>Customisable chart themes</span>
            </div>
          </div>
        </div>
        <div className="brand-decoration">
          <div className="deco-line" />
          <div className="deco-line" />
          <div className="deco-line" />
        </div>
      </div>

      {/* Right form panel */}
      <div className="auth-form-panel">
        <div className="auth-card">
          <div className="auth-header">
            <h1>Welcome back</h1>
            <p>Sign in to access your dashboard</p>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            {error && (
              <div className="error-message">
                <span className="error-icon">!</span>
                {error}
              </div>
            )}

            <div className="form-group">
              <label htmlFor="username">Username</label>
              <div className="input-wrapper">
                <span className="input-icon">⊙</span>
                <input
                  type="text"
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  required
                  disabled={loading}
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="password">Password</label>
              <div className="input-wrapper">
                <span className="input-icon">◈</span>
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  disabled={loading}
                />
              </div>
            </div>

            <button type="submit" className="auth-button" disabled={loading}>
              {loading ? (
                <span className="btn-loading">
                  <span className="spinner" />
                  Signing in…
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <div className="auth-footer">
            <div className="auth-links">
              <Link to="/admin-login" className="auth-link">Admin Login</Link>
              <span className="auth-divider">·</span>
              <Link to="/signup" className="auth-link">Create Account</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignIn;
