import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Dashboard.css';

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/signin');
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Investment Dashboard</h1>
        <div className="user-info">
          <span>Welcome, {user?.username}! ({user?.role === 'admin' ? '👑 Admin' : '👤 User'})</span>
          <button onClick={() => navigate('/profile')} className="profile-button">
            Profile
          </button>
          <button onClick={handleLogout} className="logout-button">
            Logout
          </button>
        </div>
      </div>
      <div className="dashboard-content">
        <div className="welcome-card">
          <h2>🎉 Welcome to Your Dashboard!</h2>
          <p>Your account has been successfully created.</p>
          <div className="user-details">
            <p><strong>Email:</strong> {user?.email}</p>
            <p><strong>Username:</strong> {user?.username}</p>
            <p><strong>Role:</strong> {user?.role === 'admin' ? 'Administrator' : 'Regular User'}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
