"use client";
import { useEffect, useState } from "react";
import { api, Stats, DomainCount, BlockEntry } from "@/lib/api";
import StatsCard from "@/components/StatsCard";
import DatePicker from "@/components/DatePicker";

export default function Dashboard() {
  const [date, setDate]       = useState(new Date().toISOString().slice(0, 10));
  const [stats, setStats]     = useState<Stats | null>(null);
  const [traffic, setTraffic] = useState<DomainCount[]>([]);
  const [blocks, setBlocks]   = useState<BlockEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.stats(date), api.traffic(date, 20), api.blocks(date, 20)])
      .then(([s, t, b]) => {
        setStats(s);
        setTraffic(t.domains);
        setBlocks(b.blocks);
      })
      .finally(() => setLoading(false));
  }, [date]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <DatePicker value={date} onChange={setDate} />
      </div>

      {loading ? (
        <p className="text-gray-400">Loading...</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <StatsCard title="DNS Queries"  value={stats?.queries ?? 0} color="blue"  />
            <StatsCard title="Blocks"       value={stats?.blocks  ?? 0} color="red"   />
            <StatsCard title="Devices Seen" value={stats?.devices ?? 0} color="green" />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <section>
              <h2 className="font-semibold mb-3 text-gray-700">Top Domains</h2>
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {traffic.length === 0 && <p className="p-4 text-gray-400 text-sm">No data</p>}
                {traffic.map((d) => (
                  <div key={d.domain} className="flex justify-between px-4 py-2 text-sm">
                    <span className="truncate max-w-xs text-gray-800">{d.domain}</span>
                    <span className="ml-4 font-mono text-gray-500">{d.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="font-semibold mb-3 text-gray-700">Blocked Domains</h2>
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {blocks.length === 0 && <p className="p-4 text-gray-400 text-sm">No blocks today</p>}
                {blocks.map((b) => (
                  <div key={b.domain} className="flex justify-between px-4 py-2 text-sm">
                    <span className="truncate max-w-xs text-red-700">{b.domain}</span>
                    <span className="ml-4 font-mono text-gray-500">{b.count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
