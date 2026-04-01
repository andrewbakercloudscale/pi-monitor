"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Device } from "@/lib/api";

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft]     = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.devices().then((r) => setDevices(r.devices)).finally(() => setLoading(false));
  }, []);

  async function saveLabel(mac: string) {
    await api.updateDevice(mac, draft);
    setDevices((ds) => ds.map((d) => d.mac === mac ? { ...d, label: draft } : d));
    setEditing(null);
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Devices</h1>

      {loading ? (
        <p className="text-gray-400">Loading...</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Device</th>
                <th className="text-left px-4 py-3">MAC</th>
                <th className="text-left px-4 py-3">IP</th>
                <th className="text-right px-4 py-3">Queries</th>
                <th className="text-right px-4 py-3">Blocks</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {devices.map((d) => (
                <tr key={d.mac} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    {editing === d.mac ? (
                      <form onSubmit={(e) => { e.preventDefault(); saveLabel(d.mac); }} className="flex gap-2">
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          className="border rounded px-2 py-1 text-sm w-40"
                        />
                        <button type="submit" className="text-blue-600 text-xs font-medium">Save</button>
                        <button type="button" onClick={() => setEditing(null)} className="text-gray-400 text-xs">Cancel</button>
                      </form>
                    ) : (
                      <span
                        className="cursor-pointer hover:underline font-medium"
                        onClick={() => { setEditing(d.mac); setDraft(d.label || d.mac); }}
                      >
                        {d.label || d.mac}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-500">{d.mac}</td>
                  <td className="px-4 py-3 text-gray-500">{d.last_ip}</td>
                  <td className="px-4 py-3 text-right">{d.queries_today.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-red-600">{d.blocks_today.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/devices/${d.mac}`} className="text-blue-600 text-xs hover:underline">
                      Detail →
                    </Link>
                  </td>
                </tr>
              ))}
              {devices.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No devices seen yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
