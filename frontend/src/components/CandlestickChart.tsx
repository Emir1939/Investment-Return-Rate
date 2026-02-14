import React, { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData } from 'lightweight-charts';
import { useChartSettings } from '../context/ChartContext';

interface CandlestickChartProps {
  data: CandlestickData[];
  height?: number;
}

const CandlestickChart: React.FC<CandlestickChartProps> = ({ data, height = 500 }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const { settings } = useChartSettings();

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: height,
      layout: {
        background: { color: settings.backgroundColor },
        textColor: settings.textColor,
      },
      grid: {
        vertLines: { color: settings.gridColor },
        horzLines: { color: settings.gridColor },
      },
      timeScale: {
        borderColor: settings.gridColor,
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: settings.gridColor,
      },
      crosshair: {
        vertLine: { color: 'rgba(255,255,255,0.2)', labelBackgroundColor: '#2a2a2a' },
        horzLine: { color: 'rgba(255,255,255,0.2)', labelBackgroundColor: '#2a2a2a' },
      },
    });

    chartRef.current = chart;

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: settings.upColor,
      downColor: settings.downColor,
      borderUpColor: settings.upBorderColor,
      borderDownColor: settings.downBorderColor,
      wickUpColor: settings.upBorderColor,
      wickDownColor: settings.downBorderColor,
    });

    seriesRef.current = candlestickSeries;

    if (data && data.length > 0) {
      candlestickSeries.setData(data);
      chart.timeScale().fitContent();
    }

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
      }
    };
  }, [height]);

  // Update colors when settings change
  useEffect(() => {
    if (seriesRef.current) {
      seriesRef.current.applyOptions({
        upColor: settings.upColor,
        downColor: settings.downColor,
        borderUpColor: settings.upBorderColor,
        borderDownColor: settings.downBorderColor,
        wickUpColor: settings.upBorderColor,
        wickDownColor: settings.downBorderColor,
      });
    }

    if (chartRef.current) {
      chartRef.current.applyOptions({
        layout: {
          background: { color: settings.backgroundColor },
          textColor: settings.textColor,
        },
        grid: {
          vertLines: { color: settings.gridColor },
          horzLines: { color: settings.gridColor },
        },
      });
    }
  }, [settings]);

  // Update data when it changes
  useEffect(() => {
    if (seriesRef.current && data && data.length > 0) {
      seriesRef.current.setData(data);
      if (chartRef.current) {
        chartRef.current.timeScale().fitContent();
      }
    }
  }, [data]);

  return (
    <div
      style={{
        border: `2px solid ${settings.shellColor}`,
        borderRadius: '8px',
        overflow: 'hidden',
        backgroundColor: settings.shellColor,
        padding: '2px',
      }}
    >
      <div ref={chartContainerRef} style={{ width: '100%', height: `${height}px` }} />
    </div>
  );
};

export default CandlestickChart;
