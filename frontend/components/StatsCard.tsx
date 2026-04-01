interface Props {
  title: string;
  value: number | string;
  sub?: string;
  color?: "blue" | "red" | "green" | "purple";
}

const colors = {
  blue:   "bg-blue-50 border-blue-200 text-blue-700",
  red:    "bg-red-50 border-red-200 text-red-700",
  green:  "bg-green-50 border-green-200 text-green-700",
  purple: "bg-purple-50 border-purple-200 text-purple-700",
};

export default function StatsCard({ title, value, sub, color = "blue" }: Props) {
  return (
    <div className={`rounded-xl border p-5 ${colors[color]}`}>
      <p className="text-xs font-semibold uppercase tracking-wider opacity-70">{title}</p>
      <p className="mt-1 text-3xl font-bold">{value.toLocaleString()}</p>
      {sub && <p className="mt-1 text-xs opacity-60">{sub}</p>}
    </div>
  );
}
