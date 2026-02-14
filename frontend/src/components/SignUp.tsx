import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Auth.css';

const SignUp: React.FC = () => {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('user');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    setLoading(true);

    try {
      await signup(email, username, password, fullName, phone, role);
      navigate('/market');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const passwordStrength = (): { label: string; level: number } => {
    if (!password) return { label: '', level: 0 };
    let score = 0;
    if (password.length >= 6) score++;
    if (password.length >= 10) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    if (score <= 1) return { label: 'Weak', level: 1 };
    if (score <= 3) return { label: 'Medium', level: 2 };
    return { label: 'Strong', level: 3 };
  };

  const strength = passwordStrength();

  return (
    <div className="auth-page">
      {/* Left brand panel */}
      <div className="auth-brand">
        <div className="brand-content">
          <div className="brand-logo">Q</div>
          <h2 className="brand-title">Quant Dashboard</h2>
          <p className="brand-subtitle">
            Create your account and start tracking 150+ assets across global markets
            with professional-grade charting tools.
          </p>
          <div className="brand-features">
            <div className="brand-feature">
              <span className="feature-icon">◆</span>
              <span>Free real-time market data</span>
            </div>
            <div className="brand-feature">
              <span className="feature-icon">◆</span>
              <span>Customisable candlestick charts</span>
            </div>
            <div className="brand-feature">
              <span className="feature-icon">◆</span>
              <span>Cloud-synced preferences</span>
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
        <div className="auth-card auth-card--wide">
          <div className="auth-header">
            <h1>Create Account</h1>
            <p>Join the platform in seconds</p>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            {error && (
              <div className="error-message">
                <span className="error-icon">!</span>
                {error}
              </div>
            )}

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="email">Email</label>
                <div className="input-wrapper">
                  <span className="input-icon">✉</span>
                  <input
                    type="email"
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="username">Username</label>
                <div className="input-wrapper">
                  <span className="input-icon">⊙</span>
                  <input
                    type="text"
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Choose a username"
                    required
                    disabled={loading}
                  />
                </div>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="fullName">Full Name <span className="optional-tag">optional</span></label>
                <div className="input-wrapper">
                  <span className="input-icon">⋈</span>
                  <input
                    type="text"
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="John Doe"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="phone">Phone <span className="optional-tag">optional</span></label>
                <div className="input-wrapper">
                  <span className="input-icon">☎</span>
                  <input
                    type="tel"
                    id="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 234 567 890"
                    disabled={loading}
                  />
                </div>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="role">Account Type</label>
              <div className="input-wrapper">
                <span className="input-icon">◇</span>
                <select
                  id="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  disabled={loading}
                  className="form-select"
                >
                  <option value="user">Regular User</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="password">Password</label>
                <div className="input-wrapper">
                  <span className="input-icon">◈</span>
                  <input
                    type="password"
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 6 characters"
                    required
                    disabled={loading}
                  />
                </div>
                {password && (
                  <div className="password-strength">
                    <div className="strength-bars">
                      <div className={`strength-bar ${strength.level >= 1 ? `level-${strength.level}` : ''}`} />
                      <div className={`strength-bar ${strength.level >= 2 ? `level-${strength.level}` : ''}`} />
                      <div className={`strength-bar ${strength.level >= 3 ? `level-${strength.level}` : ''}`} />
                    </div>
                    <span className={`strength-label level-${strength.level}`}>{strength.label}</span>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm Password</label>
                <div className="input-wrapper">
                  <span className="input-icon">◈</span>
                  <input
                    type="password"
                    id="confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    required
                    disabled={loading}
                  />
                </div>
              </div>
            </div>

            <button type="submit" className="auth-button" disabled={loading}>
              {loading ? (
                <span className="btn-loading">
                  <span className="spinner" />
                  Creating account…
                </span>
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          <div className="auth-footer">
            <div className="auth-links">
              <span className="footer-text">Already have an account?</span>
              <Link to="/signin" className="auth-link">Sign In</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignUp;
