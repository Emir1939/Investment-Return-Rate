import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import SignIn from './components/SignIn';
import SignUp from './components/SignUp';
import Dashboard from './components/Dashboard';
import Market from './components/Market';
import AdminLogin from './components/AdminLogin';
import Profile from './components/Profile';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ChartProvider } from './context/ChartContext';
import './App.css';

const PrivateRoute: React.FC<{ children: React.ReactElement }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/signin" />;
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <ChartProvider>
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
              <Route path="/" element={<Navigate to="/market" />} />
            </Routes>
          </div>
        </Router>
      </ChartProvider>
    </AuthProvider>
  );
};

export default App;
