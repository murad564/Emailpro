import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// Validated palette (colour-blind safe, ≥3:1 on white): series 1 and series 2.
export const C1 = '#2c5490';
export const C2 = '#1f9bd1';
const axis = { fontSize: 11, fill: '#64748b' };
const tooltipStyle = { contentStyle: { borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }, cursor: { fill: 'rgba(44,84,144,0.06)' } };

export function SimpleBar({ data, x, y, name, height = 260, horizontal = false, fmt = (v) => v }) {
  if (horizontal) {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
          <CartesianGrid horizontal={false} stroke="#eef2f7" />
          <XAxis type="number" tick={axis} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey={x} tick={axis} width={110} axisLine={false} tickLine={false} />
          <Tooltip {...tooltipStyle} formatter={(v) => [fmt(v), name]} />
          <Bar dataKey={y} name={name} fill={C1} radius={[0, 4, 4, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: -12, right: 8, top: 8, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke="#eef2f7" />
        <XAxis dataKey={x} tick={axis} axisLine={false} tickLine={false} />
        <YAxis tick={axis} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip {...tooltipStyle} formatter={(v) => [fmt(v), name]} />
        <Bar dataKey={y} name={name} fill={C1} radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PairBar({ data, x, a, b, height = 260, fmt = (v) => v }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: -12, right: 8, top: 8, bottom: 4 }} barGap={2}>
        <CartesianGrid vertical={false} stroke="#eef2f7" />
        <XAxis dataKey={x} tick={axis} axisLine={false} tickLine={false} interval={0} tickFormatter={(v) => (String(v).length > 14 ? `${String(v).slice(0, 13)}…` : v)} />
        <YAxis tick={axis} axisLine={false} tickLine={false} tickFormatter={fmt} />
        <Tooltip {...tooltipStyle} formatter={(v, n) => [fmt(v), n]} />
        <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: '#475569' }}>{v}</span>} />
        <Bar dataKey={a.key} name={a.name} fill={C1} radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey={b.key} name={b.name} fill={C2} radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SimpleLine({ data, x, y, name, height = 260 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ left: -12, right: 12, top: 8, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke="#eef2f7" />
        <XAxis dataKey={x} tick={axis} axisLine={false} tickLine={false} />
        <YAxis tick={axis} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip {...tooltipStyle} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} formatter={(v) => [v.toLocaleString(), name]} />
        <Line type="monotone" dataKey={y} name={name} stroke={C1} strokeWidth={2} dot={{ r: 4, fill: C1, stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 5 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
