import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface ChartSettings {
  backgroundColor: string;
  upColor: string;
  upBorderColor: string;
  downColor: string;
  downBorderColor: string;
}

interface ChartContextType {
  settings: ChartSettings;
  updateSettings: (newSettings: Partial<ChartSettings>) => void;
}

const defaultSettings: ChartSettings = {
  backgroundColor: '#ffffff',
  upColor: '#26a69a',
  upBorderColor: '#26a69a',
  downColor: '#ef5350',
  downBorderColor: '#ef5350',
};

const ChartContext = createContext<ChartContextType | undefined>(undefined);

export const ChartProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<ChartSettings>(() => {
    const savedSettings = localStorage.getItem('chartSettings');
    return savedSettings ? JSON.parse(savedSettings) : defaultSettings;
  });

  useEffect(() => {
    localStorage.setItem('chartSettings', JSON.stringify(settings));
  }, [settings]);

  const updateSettings = (newSettings: Partial<ChartSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  return (
    <ChartContext.Provider value={{ settings, updateSettings }}>
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
