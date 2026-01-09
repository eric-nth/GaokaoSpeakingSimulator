import React from 'react';

interface RadarChartProps {
  data: { label: string; value: number; fullMark: number }[];
  size?: number;
}

export const RadarChart: React.FC<RadarChartProps> = ({ data, size = 300 }) => {
  const center = size / 2;
  const radius = (size / 2) - 40; // Padding
  const angleSlice = (Math.PI * 2) / data.length;

  // Helper to calculate coordinates
  const getCoordinates = (value: number, max: number, index: number) => {
    const angle = index * angleSlice - Math.PI / 2; // Start from top
    const r = (value / max) * radius;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
    };
  };

  // Generate grid points (5 levels)
  const levels = 5;
  const gridPoints = Array.from({ length: levels }).map((_, levelIndex) => {
    const levelFactor = (levelIndex + 1) / levels;
    return data.map((_, i) => getCoordinates(levelFactor * 100, 100, i)); // Assuming normalized to 100
  });

  // Generate data points
  const points = data.map((d, i) => {
    // Normalize value to 0-10 based on fullMark (display uses 0-10 scale internally)
    // Avoid division by zero
    const normalized = d.fullMark ? (d.value / d.fullMark) * 10 : 0; 
    return getCoordinates(normalized, 10, i); // Scale 0-10
  });

  const pathData = points.map((p, i) => (i === 0 ? `M ${p.x},${p.y}` : `L ${p.x},${p.y}`)).join(' ') + ' Z';

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
        {/* Background Grid */}
        {gridPoints.map((levelPoints, lvl) => (
          <path
            key={lvl}
            d={levelPoints.map((p, i) => (i === 0 ? `M ${p.x},${p.y}` : `L ${p.x},${p.y}`)).join(' ') + ' Z'}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth="1"
          />
        ))}

        {/* Axes */}
        {points.map((_, i) => {
          const end = getCoordinates(10, 10, i);
          return <line key={i} x1={center} y1={center} x2={end.x} y2={end.y} stroke="#cbd5e1" strokeWidth="1" />;
        })}

        {/* Data Path */}
        <path d={pathData} fill="rgba(37, 99, 235, 0.2)" stroke="#2563eb" strokeWidth="2" />

        {/* Data Points */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="4" fill="#2563eb" />
        ))}

        {/* Labels */}
        {data.map((d, i) => {
          const labelPos = getCoordinates(12, 10, i); // Push labels out a bit
          return (
            <text
              key={i}
              x={labelPos.x}
              y={labelPos.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="text-xs font-semibold fill-slate-600 uppercase"
              style={{ fontSize: '10px' }}
            >
              {d.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
};