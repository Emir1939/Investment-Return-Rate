import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts';
import { useChartSettings } from '../context/ChartContext';

/* ── Drawing types ── */
type DrawMode = 'none' | 'hline' | 'rect' | 'fib' | 'eraser';
interface DrawShape {
  id: number;
  type: 'hline' | 'rect' | 'fib';
  price1: number;  // Ana fiyat seviyesi
  price2?: number; // rect ve fib için ikinci fiyat
  time1?: Time;    // rect için başlangıç zamanı
  time2?: Time;    // rect için bitiş zamanı
  color: string;
}

const DRAW_COLORS = ['#ffffff', '#26a69a', '#ef5350', '#ffb74d', '#42a5f5', '#ab47bc', '#ff7043'];
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
let _shapeId = 0;

interface CandlestickChartProps {
  data: CandlestickData[];
  height?: number;
}

const CandlestickChart: React.FC<CandlestickChartProps> = ({ data, height = 500 }) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { settings } = useChartSettings();

  /* ── Drawing state ── */
  const [drawMode, setDrawMode] = useState<DrawMode>('none');
  const [drawColor, setDrawColor] = useState('#ffffff');
  const [shapes, setShapes] = useState<DrawShape[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [hoveredShapeId, setHoveredShapeId] = useState<number | null>(null);
  const startRef = useRef<{ x: number; y: number; price: number; time: Time } | null>(null);
  const shapesRef = useRef<DrawShape[]>([]);
  shapesRef.current = shapes;
  const hoveredRef = useRef<number | null>(null);
  hoveredRef.current = hoveredShapeId;

  /* ── Hit-test: is point near a shape? ── */
  const hitTestShape = useCallback((px: number, py: number): DrawShape | null => {
    const T = 10;
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return null;

    for (let i = shapesRef.current.length - 1; i >= 0; i--) {
      const s = shapesRef.current[i];
      const canvas = canvasRef.current;
      if (!canvas) continue;

      if (s.type === 'hline') {
        const y = series.priceToCoordinate(s.price1);
        if (y !== null && Math.abs(py - y) < T) return s;
      } else if (s.type === 'rect' && s.time1 && s.time2 && s.price2 !== undefined) {
        const x1 = chart.timeScale().timeToCoordinate(s.time1);
        const x2 = chart.timeScale().timeToCoordinate(s.time2);
        const y1 = series.priceToCoordinate(s.price1);
        const y2 = series.priceToCoordinate(s.price2);
        if (x1 !== null && x2 !== null && y1 !== null && y2 !== null) {
          const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
          const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
          if (px >= minX - T && px <= maxX + T && py >= minY - T && py <= maxY + T) return s;
        }
      } else if (s.type === 'fib' && s.price2 !== undefined) {
        const y1 = series.priceToCoordinate(s.price1);
        const y2 = series.priceToCoordinate(s.price2);
        if (y1 !== null && y2 !== null) {
          const top = Math.min(y1, y2), bottom = Math.max(y1, y2);
          const range = bottom - top;
          for (const lvl of FIB_LEVELS) {
            if (Math.abs(py - (top + range * lvl)) < T) return s;
          }
        }
      }
    }
    return null;
  }, []);

  /* ── Redraw overlay canvas ── */
  const redrawCanvas = useCallback((tempShape?: Partial<DrawShape>) => {
    const canvas = canvasRef.current;
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!canvas || !series || !chart) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const highlightId = hoveredRef.current;

    ctx.clearRect(0, 0, W, H);

    const allShapes: (DrawShape | Partial<DrawShape>)[] = [...shapesRef.current];
    if (tempShape) allShapes.push(tempShape);

    for (const s of allShapes) {
      try {
        const hasId = 'id' in s && typeof (s as DrawShape).id === 'number';
        const isHL = hasId && highlightId != null && (s as DrawShape).id === highlightId;
        const clr = s.color || '#ffffff';
        ctx.strokeStyle = isHL ? '#ff4444' : clr;
        ctx.lineWidth = isHL ? 3 : 2;
        ctx.setLineDash([]);

        if (s.type === 'hline' && s.price1 !== undefined) {
          const y = series.priceToCoordinate(s.price1);
          if (y !== null && isFinite(y)) {
            ctx.setLineDash([8, 5]);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        } else if (s.type === 'rect' && s.price1 !== undefined && s.price2 !== undefined && s.time1 && s.time2) {
          const x1 = chart.timeScale().timeToCoordinate(s.time1);
          const x2 = chart.timeScale().timeToCoordinate(s.time2);
          const y1 = series.priceToCoordinate(s.price1);
          const y2 = series.priceToCoordinate(s.price2);
          if (x1 !== null && x2 !== null && y1 !== null && y2 !== null &&
              isFinite(x1) && isFinite(x2) && isFinite(y1) && isFinite(y2)) {
            ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
            ctx.fillStyle = clr + '10';
            ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          }
        } else if (s.type === 'fib' && s.price1 !== undefined && s.price2 !== undefined) {
          const y1 = series.priceToCoordinate(s.price1);
          const y2 = series.priceToCoordinate(s.price2);
          if (y1 !== null && y2 !== null && isFinite(y1) && isFinite(y2)) {
            const top = Math.min(y1, y2);
            const bottom = Math.max(y1, y2);
            const range = bottom - top;
            if (range > 0) {
              ctx.font = '11px monospace';
              for (const lvl of FIB_LEVELS) {
                const y = top + range * lvl;
                ctx.strokeStyle = isHL ? '#ff4444' : clr;
                ctx.lineWidth = lvl === 0 || lvl === 1 ? 2 : 1;
                ctx.setLineDash(lvl === 0.5 ? [8, 5] : [4, 3]);
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(W, y);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = clr;
                ctx.fillText(`${((1 - lvl) * 100).toFixed(1)}%`, 8, y - 4);
              }
              ctx.fillStyle = clr + '08';
              ctx.fillRect(0, top, W, range);
            }
          }
        }

        /* Trash icon on hover in eraser mode */
        if (isHL) {
          const tx = W - 36;
          let ty = 0;
          if (s.type === 'hline' && s.price1 !== undefined) {
            const y = series.priceToCoordinate(s.price1);
            ty = (y !== null && isFinite(y)) ? y - 24 : 0;
          } else if (s.price1 !== undefined && s.price2 !== undefined) {
            const y1 = series.priceToCoordinate(s.price1);
            const y2 = series.priceToCoordinate(s.price2);
            ty = (y1 !== null && y2 !== null && isFinite(y1) && isFinite(y2)) ? Math.min(y1, y2) - 24 : 0;
          }
          ctx.fillStyle = 'rgba(239,83,80,0.92)';
          ctx.beginPath();
          ctx.moveTo(tx, ty); ctx.lineTo(tx + 28, ty);
          ctx.lineTo(tx + 28, ty + 22); ctx.lineTo(tx, ty + 22);
          ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = '14px sans-serif';
          ctx.fillText('\u{1F5D1}', tx + 5, ty + 16);
        }
      } catch (err) {
        console.warn('Drawing shape error:', err);
      }
    }
  }, []);

  /* ── Canvas mouse handlers ── */
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    try {
      const rect = canvasRef.current!.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const series = seriesRef.current;
      const chart = chartRef.current;
      const canvas = canvasRef.current;
      if (!series || !chart || !canvas) return;

      if (drawMode === 'eraser') {
        const hit = hitTestShape(px, py);
        if (hit) {
          setShapes(prev => prev.filter(s => s.id !== hit.id));
          setHoveredShapeId(null);
        }
        return;
      }

      if (drawMode === 'hline') {
        const price = series.coordinateToPrice(py);
        if (price !== null) {
          setShapes(prev => [...prev, {
            id: ++_shapeId, type: 'hline',
            price1: price,
            color: drawColor,
          }]);
        }
        return;
      }

      if (drawMode === 'rect' || drawMode === 'fib') {
        const price = series.coordinateToPrice(py);
        const time = chart.timeScale().coordinateToTime(px);
        if (price !== null && time !== null) {
          startRef.current = { x: px, y: py, price, time };
          setIsDrawing(true);
        }
      }
    } catch (err) {
      console.warn('handleMouseDown error:', err);
    }
  }, [drawMode, drawColor, hitTestShape]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    try {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const series = seriesRef.current;
      const chart = chartRef.current;
      if (!series || !chart) return;

      if (drawMode === 'eraser') {
        const hit = hitTestShape(px, py);
        const newId = hit?.id ?? null;
        if (newId !== hoveredRef.current) {
          setHoveredShapeId(newId);
        }
        return;
      }

      if (!isDrawing || !startRef.current) return;

      const currentPrice = series.coordinateToPrice(py);
      const currentTime = chart.timeScale().coordinateToTime(px);
      if (currentPrice === null || currentTime === null) return;

      if (drawMode === 'rect' && startRef.current.price !== undefined && startRef.current.time !== undefined) {
        redrawCanvas({
          type: 'rect',
          price1: startRef.current.price,
          price2: currentPrice,
          time1: startRef.current.time,
          time2: currentTime,
          color: drawColor
        });
      } else if (drawMode === 'fib' && startRef.current.price !== undefined) {
        redrawCanvas({
          type: 'fib',
          price1: startRef.current.price,
          price2: currentPrice,
          color: drawColor
        });
      }
    } catch (err) {
      console.warn('handleMouseMove error:', err);
    }
  }, [isDrawing, drawMode, drawColor, hitTestShape, redrawCanvas]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    try {
      if (!isDrawing || !startRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const series = seriesRef.current;
      const chart = chartRef.current;
      if (!series || !chart) return;

      const currentPrice = series.coordinateToPrice(py);
      const currentTime = chart.timeScale().coordinateToTime(px);
      if (currentPrice === null || currentTime === null) {
        setIsDrawing(false);
        startRef.current = null;
        return;
      }

      // Capture start values before clearing ref
      const startPrice = startRef.current.price;
      const startTime = startRef.current.time;
      const startX = startRef.current.x;
      const startY = startRef.current.y;

      const dy = Math.abs(py - startY);
      if (dy > 5) {
        if (drawMode === 'rect' && startPrice !== undefined && startTime !== undefined) {
          const dx = Math.abs(px - startX);
          if (dx > 3 || dy > 3) {
            const newId = ++_shapeId;
            setShapes(prev => [...prev, {
              id: newId, type: 'rect',
              price1: startPrice,
              price2: currentPrice,
              time1: startTime,
              time2: currentTime,
              color: drawColor,
            }]);
          }
        } else if (drawMode === 'fib' && startPrice !== undefined) {
          const newId = ++_shapeId;
          setShapes(prev => [...prev, {
            id: newId, type: 'fib',
            price1: startPrice,
            price2: currentPrice,
            color: drawColor,
          }]);
        }
      }
      setIsDrawing(false);
      startRef.current = null;
    } catch (err) {
      console.warn('handleMouseUp error:', err);
      setIsDrawing(false);
      startRef.current = null;
    }
  }, [isDrawing, drawMode, drawColor]);

  const clearDrawings = () => {
    setShapes([]);
    setHoveredShapeId(null);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  /* ── Redraw when shapes change ── */
  useEffect(() => {
    redrawCanvas();
  }, [shapes, hoveredShapeId, redrawCanvas]);

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
        // Resize overlay canvas
        if (canvasRef.current) {
          canvasRef.current.width = chartContainerRef.current.clientWidth;
          canvasRef.current.height = height;
          redrawCanvas();
        }
      }
    };

    // Listen to chart zoom/pan events to redraw shapes
    const handleVisibleRangeChange = () => {
      redrawCanvas();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);

    window.addEventListener('resize', handleResize);

    // Set canvas size
    if (canvasRef.current && chartContainerRef.current) {
      canvasRef.current.width = chartContainerRef.current.clientWidth;
      canvasRef.current.height = height;
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      if (chartRef.current) {
        chartRef.current.remove();
      }
    };
  }, [height, redrawCanvas]);

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
    <div style={{ position: 'relative' }}>
      {/* ── Drawing toolbar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '8px 12px',
        background: settings.shellColor,
        borderRadius: '8px 8px 0 0',
        borderBottom: `1px solid ${settings.gridColor}`,
        flexWrap: 'wrap',
      }}>
        {([
          { mode: 'none' as DrawMode, label: 'Cursor' },
          { mode: 'hline' as DrawMode, label: '─ Line' },
          { mode: 'rect' as DrawMode, label: '▭ Rect' },
          { mode: 'fib' as DrawMode, label: '◈ Fib' },
          { mode: 'eraser' as DrawMode, label: '🗑 Delete' },
        ]).map(btn => (
          <button
            key={btn.mode}
            onClick={() => { setDrawMode(btn.mode); setShowColorPicker(false); setHoveredShapeId(null); }}
            style={{
              padding: '5px 12px', border: '1px solid',
              borderColor: drawMode === btn.mode ? '#fff' : '#555',
              borderRadius: '4px', cursor: 'pointer',
              background: drawMode === btn.mode ? 'rgba(255,255,255,0.12)' : 'transparent',
              color: btn.mode === 'eraser' && drawMode === 'eraser' ? '#ef5350' : '#ddd',
              fontSize: '12px', fontWeight: 600, fontFamily: 'inherit',
            }}
          >
            {btn.label}
          </button>
        ))}

        <div style={{ width: '1px', height: '20px', background: '#444', margin: '0 4px' }} />

        {/* Color picker toggle */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowColorPicker(!showColorPicker)}
            style={{
              padding: '5px 12px', border: '1px solid #555',
              borderRadius: '4px', cursor: 'pointer',
              background: 'transparent', color: '#ddd',
              fontSize: '12px', fontWeight: 600, fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}
          >
            <span style={{
              display: 'inline-block', width: '14px', height: '14px',
              background: drawColor, borderRadius: '3px',
              border: '1px solid rgba(255,255,255,0.3)',
            }} />
            Color
          </button>
          {showColorPicker && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: '4px',
              background: '#1e1e1e', border: '1px solid #444',
              borderRadius: '6px', padding: '8px',
              display: 'flex', gap: '6px', zIndex: 10,
            }}>
              {DRAW_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => { setDrawColor(c); setShowColorPicker(false); }}
                  style={{
                    width: '24px', height: '24px',
                    background: c, border: drawColor === c ? '2px solid #fff' : '1px solid #555',
                    borderRadius: '4px', cursor: 'pointer', padding: 0,
                  }}
                />
              ))}
              <input
                type="color"
                value={drawColor}
                onChange={e => { setDrawColor(e.target.value); setShowColorPicker(false); }}
                style={{
                  width: '24px', height: '24px',
                  border: '1px solid #555', borderRadius: '4px',
                  cursor: 'pointer', padding: 0, background: 'none',
                }}
                title="Custom color"
              />
            </div>
          )}
        </div>

        <div style={{ width: '1px', height: '20px', background: '#444', margin: '0 4px' }} />

        <button
          onClick={clearDrawings}
          disabled={shapes.length === 0}
          style={{
            padding: '5px 12px', border: '1px solid #555',
            borderRadius: '4px', cursor: shapes.length ? 'pointer' : 'not-allowed',
            background: 'transparent', color: shapes.length ? '#ef5350' : '#555',
            fontSize: '12px', fontWeight: 600, fontFamily: 'inherit',
          }}
        >
          Clear All
        </button>

        {shapes.length > 0 && (
          <span style={{ fontSize: '11px', color: '#666', marginLeft: '4px' }}>
            {shapes.length} drawing{shapes.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Chart + drawing overlay ── */}
      <div
        style={{
          position: 'relative',
          border: `2px solid ${settings.shellColor}`,
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          overflow: 'hidden',
          backgroundColor: settings.shellColor,
          padding: '2px',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        <div ref={chartContainerRef} style={{ width: '100%', height: `${height}px` }} />
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { if (isDrawing) { setIsDrawing(false); startRef.current = null; redrawCanvas(); } }}
          style={{
            position: 'absolute',
            top: '2px',
            left: '2px',
            width: 'calc(100% - 4px)',
            height: `${height}px`,
            pointerEvents: drawMode === 'none' ? 'none' : 'auto',
            cursor: drawMode === 'eraser' ? 'pointer' : drawMode !== 'none' ? 'crosshair' : 'default',
            zIndex: 5,
            userSelect: 'none',
            WebkitUserSelect: 'none',
            touchAction: 'none',
          }}
        />
      </div>
    </div>
  );
};

export default CandlestickChart;
