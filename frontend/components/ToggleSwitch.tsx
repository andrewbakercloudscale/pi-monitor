"use client";
import { useState } from "react";

interface Props {
  checked: boolean;
  onChange: (next: boolean) => Promise<void>;
  label?: string;
  disabled?: boolean;
}

export default function ToggleSwitch({ checked, onChange, label, disabled }: Props) {
  const [loading, setLoading] = useState(false);
  const [optimistic, setOptimistic] = useState(checked);

  async function handle() {
    if (loading || disabled) return;
    const next = !optimistic;
    setOptimistic(next);   // optimistic
    setLoading(true);
    try {
      await onChange(next);
    } catch {
      setOptimistic(!next); // rollback
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handle}
      disabled={loading || disabled}
      aria-checked={optimistic}
      role="switch"
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none
        ${optimistic ? "bg-red-500" : "bg-gray-300"}
        ${loading ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform
          ${optimistic ? "translate-x-6" : "translate-x-1"}`}
      />
      {label && <span className="sr-only">{label}</span>}
    </button>
  );
}
