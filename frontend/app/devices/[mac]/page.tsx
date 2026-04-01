"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, DomainCount, BlockEntry } from "@/lib/api";
import DatePicker from "@/components/DatePicker";

export default function DeviceDetailPage() {
  const { mac } = useParams<{ mac: string }>();
  const [date, setDate]     = useState(new Date().toISOString().slice(0, 10));
  const [queries, setQueries] = useState<DomainCount[]>([]);
  const [blocks, setBlocks]   = useState<BlockEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.deviceTraffic(mac, date)
      .then((r) => { setQueries(r.queries); setBlocks(r.blocks); })
      .finally(() => setLoading(false));
  }, [mac, date]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Device Detail</h1>
          <p className="text-gray-500 font-mono text-sm mt-0.5">{mac}</p>
        </div>
        <DatePicker value={date} onChange={setDate} />
      </div>

      {loading ? (
        <p className="text-gray-400">Loading...</p>
      ) : (
        <div className="grid grid-cols-2 gap-6">
          <section>
            <h2 className="font-semibold mb-3 text-gray-700">Queries ({queries.length})</h2>
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
              {queries.length === 0 && <p className="p-4 text-gray-400 text-sm">No queries</p>}
              {queries.map((d) => (
                <div key={d.domain} className="flex justify-between px-4 py-2 text-sm">
                  <span className="truncate max-w-xs text-gray-800">{d.domain}</span>
                  <span className="ml-4 font-mono text-gray-500">{d.count}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="font-semibold mb-3 text-gray-700">Blocks ({blocks.length})</h2>
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
              {blocks.length === 0 && <p className="p-4 text-gray-400 text-sm">No blocks</p>}
              {blocks.map((b) => (
                <div key={b.domain} className="flex justify-between px-4 py-2 text-sm">
                  <span className="truncate max-w-xs text-red-700">{b.domain}</span>
                  <span className="ml-4 font-mono text-gray-500">{b.count}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
