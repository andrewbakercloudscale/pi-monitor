"use client";
import { useEffect, useState } from "react";
import { api, Device, Schedule } from "@/lib/api";

export default function SettingsPage() {
  const [devices, setDevices]     = useState<Device[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [editing, setEditing]     = useState<string | null>(null);
  const [draft, setDraft]         = useState("");
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    Promise.all([api.devices(), api.schedules()])
      .then(([d, s]) => { setDevices(d.devices); setSchedules(s.schedules); })
      .finally(() => setLoading(false));
  }, []);

  async function saveLabel(mac: string) {
    await api.updateDevice(mac, draft);
    setDevices((ds) => ds.map((d) => d.mac === mac ? { ...d, label: draft } : d));
    setEditing(null);
  }

  async function deleteSchedule(id: number) {
    await api.deleteSchedule(id);
    setSchedules((ss) => ss.filter((s) => s.id !== id));
  }

  if (loading) return <p className="text-gray-400">Loading...</p>;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Device labels */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-lg font-semibold mb-4">Device Labels</h2>
        <div className="divide-y divide-gray-100">
          {devices.map((d) => (
            <div key={d.mac} className="flex items-center justify-between py-3">
              <span className="font-mono text-sm text-gray-500">{d.mac}</span>
              {editing === d.mac ? (
                <form onSubmit={(e) => { e.preventDefault(); saveLabel(d.mac); }} className="flex gap-2">
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    className="border rounded px-2 py-1 text-sm w-48"
                  />
                  <button type="submit" className="text-blue-600 text-sm font-medium">Save</button>
                  <button type="button" onClick={() => setEditing(null)} className="text-gray-400 text-sm">Cancel</button>
                </form>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{d.label || "—"}</span>
                  <button
                    onClick={() => { setEditing(d.mac); setDraft(d.label || ""); }}
                    className="text-blue-600 text-xs hover:underline"
                  >
                    Rename
                  </button>
                </div>
              )}
            </div>
          ))}
          {devices.length === 0 && <p className="text-gray-400 text-sm py-2">No devices yet</p>}
        </div>
      </section>

      {/* Schedules overview */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-lg font-semibold mb-4">Active Schedules</h2>
        <div className="divide-y divide-gray-100">
          {schedules.map((s) => (
            <div key={s.id} className="flex items-center justify-between py-3 text-sm">
              <div>
                <span className="font-medium capitalize">{s.scope_key}</span>
                <span className="ml-2 text-gray-400 text-xs">({s.scope_type})</span>
              </div>
              <span className="text-gray-500 text-xs">
                Weekdays {s.weekday_start}–{s.weekday_end} | Weekends {s.weekend_start}–{s.weekend_end}
              </span>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded-full ${s.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                  {s.enabled ? "Active" : "Paused"}
                </span>
                <button onClick={() => deleteSchedule(s.id)} className="text-red-500 hover:text-red-700 text-xs">Delete</button>
              </div>
            </div>
          ))}
          {schedules.length === 0 && <p className="text-gray-400 text-sm py-2">No schedules configured</p>}
        </div>
        <p className="mt-3 text-xs text-gray-400">Manage schedules per-category on the Controls page.</p>
      </section>
    </div>
  );
}
