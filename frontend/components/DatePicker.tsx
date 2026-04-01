"use client";

interface Props {
  value: string;   // YYYY-MM-DD
  onChange: (d: string) => void;
}

function shift(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function DatePicker({ value, onChange }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const isToday = value >= today;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(shift(value, -1))}
        className="rounded px-2 py-1 text-sm bg-gray-100 hover:bg-gray-200"
      >
        ‹ Prev
      </button>
      <input
        type="date"
        value={value}
        max={today}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-gray-300 px-2 py-1 text-sm"
      />
      <button
        onClick={() => onChange(shift(value, 1))}
        disabled={isToday}
        className="rounded px-2 py-1 text-sm bg-gray-100 hover:bg-gray-200 disabled:opacity-40"
      >
        Next ›
      </button>
    </div>
  );
}
