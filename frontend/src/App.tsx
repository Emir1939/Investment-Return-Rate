import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import SignIn from './components/SignIn';
import SignUp from './components/SignUp';
import Dashboard from './components/Dashboard';
import Market from './components/Market';
import AdminLogin from './components/AdminLogin';
import Profile from './components/Profile';
import Portfolio from './components/Portfolio';
import ErrorBoundary from './components/ErrorBoundary';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ChartProvider } from './context/ChartContext';
import './App.css';

const PrivateRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: '#0d0d0d',
        color: '#f5f5f5',
        fontSize: '16px',
        zIndex: 9999
      }}>
        <div>Loading...</div>
      </div>
    );
  }
  
  return isAuthenticated ? children : <Navigate to="/signin" />;
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <ChartProvider>
        <ErrorBoundary>
        <Router>
          <div className="App">
            <Routes>
              <Route path="/signin" element={<SignIn />} />
              <Route path="/admin-login" element={<AdminLogin />} />
              <Route path="/signup" element={<SignUp />} />
              <Route 
                path="/market" 
                element={
                  <PrivateRoute>
                    <Market />
                  </PrivateRoute>
                } 
              />
              <Route 
                path="/dashboard" 
                element={
                  <PrivateRoute>
                    <Dashboard />
                  </PrivateRoute>
                } 
              />
              <Route 
                path="/profile" 
                element={
                  <PrivateRoute>
                    <Profile />
                  </PrivateRoute>
                } 
              />
              <Route 
                path="/portfolio" 
                element={
                  <PrivateRoute>
                    <Portfolio />
                  </PrivateRoute>
                } 
              />
              <Route path="/" element={<Navigate to="/market" />} />
            </Routes>
          </div>
        </Router>
        </ErrorBoundary>
      </ChartProvider>
    </AuthProvider>
  );
};

export default App;
