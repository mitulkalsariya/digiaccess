'use client';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

export interface TrendPoint {
  date: string;
  total: number;
  newCount: number;
  fixed: number;
}

export function TrendsChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return <p>No scan history yet for this site.</p>;
  }
  return (
    <div role="img" aria-label="Violation trends over time" style={{ width: '100%', height: 300 }}>
      <ResponsiveContainer>
        <LineChart data={points}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="total" stroke="#1d4ed8" name="Total" />
          <Line type="monotone" dataKey="newCount" stroke="#b91c1c" name="New" />
          <Line type="monotone" dataKey="fixed" stroke="#15803d" name="Fixed" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
