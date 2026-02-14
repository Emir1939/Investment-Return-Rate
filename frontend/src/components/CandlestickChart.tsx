import React, { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData } from 'lightweight-charts';
import { useChartSettings } from '../context/ChartContext';

interface CandlestickChartProps {
  data: CandlestickData[];
  height?: number;
}

const CandlestickChart: React.FC<CandlestickChartProps> = ({ data, height = 400 }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const { settings } = useChartSettings();

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: height,
      layout: {
        background: { color: settings.backgroundColor },
        textColor: '#333',
      },
      grid: {
        vertLines: { color: '#f0f0f0' },
        horzLines: { color: '#f0f0f0' },
      },
      timeScale: {
        borderColor: '#ccc',
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: '#ccc',
      },
    });

    chartRef.current = chart;

    // Add candlestick series
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: settings.upColor,
      downColor: settings.downColor,
      borderUpColor: settings.upBorderColor,
      borderDownColor: settings.downBorderColor,
      wickUpColor: settings.upBorderColor,
      wickDownColor: settings.downBorderColor,
    });

    seriesRef.current = candlestickSeries;

    // Set data
    if (data && data.length > 0) {
      candlestickSeries.setData(data);
      chart.timeScale().fitContent();
    }

    // Handle resize
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
          textColor: '#333',
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

  return <div ref={chartContainerRef} style={{ width: '100%', height: `${height}px` }} />;
};

export default CandlestickChart;
