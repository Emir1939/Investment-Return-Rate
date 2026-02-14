import React, { useState } from 'react';
import { ChromePicker } from 'react-color';
import { useChartSettings } from '../context/ChartContext';
import { useAuth } from '../context/AuthContext';
import './ChartSettings.css';

interface ChartSettingsProps {
  onClose: () => void;
}

const ChartSettings: React.FC<ChartSettingsProps> = ({ onClose }) => {
  const { settings, updateSettings, syncToServer } = useChartSettings();
  const { user } = useAuth();
  const [activeColorPicker, setActiveColorPicker] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const colorSettings = [
    { key: 'backgroundColor', label: 'Background Color', value: settings.backgroundColor },
    { key: 'upColor', label: 'Bullish Candle Fill', value: settings.upColor },
    { key: 'upBorderColor', label: 'Bullish Wick / Border', value: settings.upBorderColor },
    { key: 'downColor', label: 'Bearish Candle Fill', value: settings.downColor },
    { key: 'downBorderColor', label: 'Bearish Wick / Border', value: settings.downBorderColor },
    { key: 'shellColor', label: 'Chart Shell (Container)', value: settings.shellColor },
  ];

  const handleColorChange = (key: string, color: any) => {
    updateSettings({ [key]: color.hex });
  };

  const resetToDefaults = () => {
    updateSettings({
      backgroundColor: '#131722',
      upColor: '#26a69a',
      upBorderColor: '#26a69a',
      downColor: '#ef5350',
      downBorderColor: '#ef5350',
      shellColor: '#1e222d',
      gridColor: '#1e222d',
      textColor: '#d1d4dc',
    });
  };

  const handleSave = async () => {
    if (user) {
      setSaving(true);
      const token = localStorage.getItem('token');
      if (token) {
        await syncToServer(user.username, token);
      }
      setSaving(false);
    }
    onClose();
  };

  return (
    <div className="chart-settings-overlay" onClick={onClose}>
      <div className="chart-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Chart Settings</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="settings-content">
          <div className="color-controls">
            {colorSettings.map((setting) => (
              <div key={setting.key} className="color-control">
                <label>{setting.label}</label>
                <div className="color-picker-container">
                  <div
                    className="color-preview"
                    style={{ backgroundColor: setting.value }}
                    onClick={() => setActiveColorPicker(
                      activeColorPicker === setting.key ? null : setting.key
                    )}
                  />
                  <span className="color-value">{setting.value}</span>
                  {activeColorPicker === setting.key && (
                    <div className="color-picker-popover">
                      <ChromePicker
                        color={setting.value}
                        onChange={(color) => handleColorChange(setting.key, color)}
                        disableAlpha
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="settings-actions">
            <button className="btn-secondary" onClick={resetToDefaults}>
              Reset to Defaults
            </button>
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save & Close'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChartSettings;
