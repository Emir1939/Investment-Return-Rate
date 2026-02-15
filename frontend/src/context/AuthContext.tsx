import React, { createContext, useState, useContext, useEffect } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  loginUser: (username: string, password: string) => Promise<void>;
  loginAdmin: (username: string, password: string) => Promise<void>;
  signup: (email: string, username: string, password: string, fullName?: string, phone?: string, role?: string) => Promise<void>;
  logout: () => void;
  updateProfile: (data: {
    email?: string;
    username?: string;
    full_name?: string;
    phone?: string;
    password?: string;
  }) => Promise<User>;
}

interface User {
  username: string;
  email: string;
  full_name?: string;
  phone?: string;
  role: string;
  is_active: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      fetchUser(token);
    } else {
      setIsLoading(false);
    }
  }, []);

  const fetchUser = async (token: string) => {
    try {
      const response = await axios.get(`${API_URL}/api/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUser(response.data);
      setIsAuthenticated(true);
      setIsLoading(false);
    } catch (error: any) {
      // Only remove token if it's actually invalid (401/403)
      // Don't logout on network errors or temporary issues
      if (error.response?.status === 401 || error.response?.status === 403) {
        console.log('Token invalid, logging out');
        localStorage.removeItem('token');
        setIsAuthenticated(false);
        setUser(null);
      } else {
        console.error('Network error fetching user, keeping authenticated with cached token:', error.message);
        // Keep token AND stay authenticated on network errors
        // User data will be fetched on next successful request
        setIsAuthenticated(true);
        setUser(null); // Will be populated on next successful API call
      }
      setIsLoading(false);
    }
  };

  const login = async (username: string, password: string) => {
    try {
      const response = await axios.post(`${API_URL}/api/login`, {
        username,
        password
      });
      const { access_token } = response.data;
      localStorage.setItem('token', access_token);
      await fetchUser(access_token);
    } catch (error) {
      throw error;
    }
  };

  const loginUser = async (username: string, password: string) => {
    try {
      const response = await axios.post(`${API_URL}/api/login/user`, {
        username,
        password
      });
      const { access_token } = response.data;
      localStorage.setItem('token', access_token);
      await fetchUser(access_token);
    } catch (error) {
      throw error;
    }
  };

  const loginAdmin = async (username: string, password: string) => {
    try {
      const response = await axios.post(`${API_URL}/api/login/admin`, {
        username,
        password
      });
      const { access_token } = response.data;
      localStorage.setItem('token', access_token);
      await fetchUser(access_token);
    } catch (error) {
      throw error;
    }
  };

  const signup = async (email: string, username: string, password: string, fullName?: string, phone?: string, role?: string) => {
    try {
      const response = await axios.post(`${API_URL}/api/signup`, {
        email,
        username,
        password,
        full_name: fullName,
        phone,
        role: role || 'user'
      });
      const { access_token } = response.data;
      localStorage.setItem('token', access_token);
      await fetchUser(access_token);
    } catch (error) {
      throw error;
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setIsAuthenticated(false);
    setUser(null);
  };

  const updateProfile = async (data: {
    email?: string;
    username?: string;
    full_name?: string;
    phone?: string;
    password?: string;
  }) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.put(`${API_URL}/api/profile`, data, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUser(response.data);
      return response.data;
    } catch (error) {
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, user, loginUser, loginAdmin, signup, logout, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
