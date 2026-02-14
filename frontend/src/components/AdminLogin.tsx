import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Auth.css';

const AdminLogin: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { loginAdmin } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await loginAdmin(username, password);
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
      <div className="auth-brand auth-brand--admin">
        <div className="brand-content">
          <div className="brand-logo">Q</div>
          <h2 className="brand-title">Admin Console</h2>
          <p className="brand-subtitle">
            Restricted area. Only authorised administrators can access the management panel.
          </p>
          <div className="brand-features">
            <div className="brand-feature">
              <span className="feature-icon">◆</span>
              <span>User management</span>
            </div>
            <div className="brand-feature">
              <span className="feature-icon">◆</span>
              <span>System monitoring</span>
            </div>
            <div className="brand-feature">
              <span className="feature-icon">◆</span>
              <span>Full access control</span>
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
            <div className="admin-badge">ADMIN</div>
            <h1>Administrator Login</h1>
            <p>Enter your admin credentials</p>
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
                  placeholder="Admin username"
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
                  placeholder="Admin password"
                  required
                  disabled={loading}
                />
              </div>
            </div>

            <button type="submit" className="auth-button auth-button--admin" disabled={loading}>
              {loading ? (
                <span className="btn-loading">
                  <span className="spinner" />
                  Authenticating…
                </span>
              ) : (
                'Sign In as Admin'
              )}
            </button>
          </form>

          <div className="auth-footer">
            <div className="auth-links">
              <Link to="/signin" className="auth-link">User Login</Link>
              <span className="auth-divider">·</span>
              <Link to="/signup" className="auth-link">Create Account</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;
