import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000';

interface ChartSettings {
  backgroundColor: string;
  upColor: string;
  upBorderColor: string;
  downColor: string;
  downBorderColor: string;
  shellColor: string;
  gridColor: string;
  textColor: string;
  defaultInterval: string;
  defaultFiat: string;
}

interface ChartContextType {
  settings: ChartSettings;
  updateSettings: (newSettings: Partial<ChartSettings>) => void;
  syncToServer: (username: string, token: string) => Promise<void>;
  loadFromServer: (username: string, token: string) => Promise<void>;
}

const defaultSettings: ChartSettings = {
  backgroundColor: '#131722',
  upColor: '#26a69a',
  upBorderColor: '#26a69a',
  downColor: '#ef5350',
  downBorderColor: '#ef5350',
  shellColor: '#1e222d',
  gridColor: '#1e222d',
  textColor: '#d1d4dc',
  defaultInterval: '1d',
  defaultFiat: 'USD',
};

const ChartContext = createContext<ChartContextType | undefined>(undefined);

export const ChartProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<ChartSettings>(() => {
    const savedSettings = localStorage.getItem('chartSettings');
    return savedSettings ? { ...defaultSettings, ...JSON.parse(savedSettings) } : defaultSettings;
  });

  useEffect(() => {
    localStorage.setItem('chartSettings', JSON.stringify(settings));
  }, [settings]);

  const updateSettings = (newSettings: Partial<ChartSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  const syncToServer = async (username: string, token: string) => {
    try {
      await axios.post(`${API_URL}/api/users/${username}/preferences`, {
        background_color: settings.backgroundColor,
        up_color: settings.upColor,
        down_color: settings.downColor,
        up_border_color: settings.upBorderColor,
        down_border_color: settings.downBorderColor,
        shell_color: settings.shellColor,
        default_interval: settings.defaultInterval,
        default_fiat: settings.defaultFiat,
      }, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error('Failed to sync preferences to server:', err);
    }
  };

  const loadFromServer = async (username: string, token: string) => {
    try {
      const res = await axios.get(`${API_URL}/api/users/${username}/preferences`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = res.data;
      const serverSettings: Partial<ChartSettings> = {
        backgroundColor: d.background_color,
        upColor: d.up_color,
        downColor: d.down_color,
        upBorderColor: d.up_border_color,
        downBorderColor: d.down_border_color,
        shellColor: d.shell_color,
        defaultInterval: d.default_interval,
        defaultFiat: d.default_fiat,
      };
      setSettings(prev => ({ ...prev, ...serverSettings }));
    } catch (err) {
      console.error('Failed to load preferences from server:', err);
    }
  };

  return (
    <ChartContext.Provider value={{ settings, updateSettings, syncToServer, loadFromServer }}>
      {children}
    </ChartContext.Provider>
  );
};

export const useChartSettings = () => {
  const context = useContext(ChartContext);
  if (!context) {
    throw new Error('useChartSettings must be used within ChartProvider');
  }
  return context;
};
