"use client";
import { useEffect, useState } from "react";
import { api, Rule, Schedule, CategoryMeta } from "@/lib/api";
import ToggleSwitch from "@/components/ToggleSwitch";

interface GroupedRules {
  [serviceKey: string]: Rule[];
}

function groupByService(rules: Rule[]): GroupedRules {
  return rules.reduce<GroupedRules>((acc, r) => {
    const k = r.service_key;
    acc[k] = acc[k] ?? [];
    acc[k].push(r);
    return acc;
  }, {});
}

function allBlocked(rules: Rule[]): boolean {
  return rules.length > 0 && rules.every((r) => r.is_blocked);
}

const CATEGORY_ORDER = ["gaming", "social", "streaming"];
const CATEGORY_ICONS: Record<string, string> = {
  gaming:    "🎮",
  social:    "💬",
  streaming: "📺",
};

export default function ControlsPage() {
  const [rules, setRules]         = useState<Rule[]>([]);
  const [cats, setCats]           = useState<Record<string, CategoryMeta>>({});
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading]     = useState(true);

  // custom rule form
  const [customName, setCustomName]   = useState("");
  const [customValue, setCustomValue] = useState("");
  const [customType, setCustomType]   = useState("domain");

  // schedule form state
  const [editSched, setEditSched] = useState<string | null>(null);
  const [schedForm, setSchedForm] = useState({
    weekday_start: "", weekday_end: "",
    weekend_start: "", weekend_end: "",
  });

  useEffect(() => {
    Promise.all([api.rules(), api.schedules()]).then(([r, s]) => {
      setRules(r.rules);
      setCats(r.categories);
      setSchedules(s.schedules);
    }).finally(() => setLoading(false));
  }, []);

  function schedFor(key: string): Schedule | undefined {
    return schedules.find((s) => s.scope_key === key && s.scope_type === "category");
  }

  async function toggleRule(rule: Rule) {
    const res = await api.toggleRule(rule.id);
    setRules((rs) => rs.map((r) => r.id === rule.id ? { ...r, is_blocked: res.is_blocked } : r));
  }

  async function toggleCategory(slug: string) {
    const res = await api.toggleCategory(slug);
    const newBlocked = res.is_blocked;
    setRules((rs) =>
      rs.map((r) => r.category === slug && !r.is_custom ? { ...r, is_blocked: newBlocked } : r)
    );
  }

  async function addCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!customValue.trim()) return;
    const rule = await api.addCustomRule(customName || customValue, customValue, customType);
    setRules((rs) => [...rs, rule]);
    setCustomName(""); setCustomValue("");
  }

  async function deleteRule(id: number) {
    await api.deleteRule(id);
    setRules((rs) => rs.filter((r) => r.id !== id));
  }

  async function saveSchedule(scopeKey: string) {
    const sched = await api.upsertSchedule({ scope_type: "category", scope_key: scopeKey, ...schedForm, enabled: true });
    setSchedules((ss) => {
      const idx = ss.findIndex((s) => s.scope_key === scopeKey && s.scope_type === "category");
      if (idx >= 0) { const copy = [...ss]; copy[idx] = sched; return copy; }
      return [...ss, sched];
    });
    setEditSched(null);
  }

  if (loading) return <p className="text-gray-400">Loading...</p>;

  const builtinRules = rules.filter((r) => !r.is_custom);
  const customRules  = rules.filter((r) => r.is_custom);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Controls</h1>

      {/* ── Category blocks ── */}
      {CATEGORY_ORDER.map((slug) => {
        const meta      = cats[slug];
        if (!meta) return null;
        const catRules  = builtinRules.filter((r) => r.category === slug);
        const grouped   = groupByService(catRules);
        const catBlocked = allBlocked(catRules);
        const sched      = schedFor(slug);

        return (
          <section key={slug} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">
                {CATEGORY_ICONS[slug]} {meta.label}
              </h2>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">{catBlocked ? "All blocked" : "Allowed"}</span>
                <ToggleSwitch
                  checked={catBlocked}
                  onChange={async () => { await toggleCategory(slug); }}
                />
              </div>
            </div>

            {/* Services */}
            <div className="divide-y divide-gray-100">
              {Object.entries(meta.services).map(([sk, label]) => {
                const serviceRules = grouped[sk] ?? [];
                const blocked      = allBlocked(serviceRules);
                return (
                  <div key={sk} className="py-3 flex items-center justify-between">
                    <span className="text-sm font-medium">{label}</span>
                    <ToggleSwitch
                      checked={blocked}
                      onChange={async () => {
                        for (const r of serviceRules) {
                          if ((r.is_blocked === 1) !== blocked) continue;
                          await toggleRule(r);
                        }
                        // toggle all at once via first rule then sync state
                        setRules((rs) =>
                          rs.map((r) => r.service_key === sk ? { ...r, is_blocked: blocked ? 0 : 1 } : r)
                        );
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Schedule */}
            <div className="mt-4 pt-4 border-t border-gray-100">
              {editSched === slug ? (
                <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveSchedule(slug); }}>
                  <p className="text-xs font-semibold text-gray-500 uppercase">Allowed window (when access is permitted)</p>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <label className="block text-gray-500 mb-1">Weekday start</label>
                      <input type="time" value={schedForm.weekday_start} onChange={(e) => setSchedForm((f) => ({ ...f, weekday_start: e.target.value }))} className="border rounded px-2 py-1 w-full" />
                    </div>
                    <div>
                      <label className="block text-gray-500 mb-1">Weekday end</label>
                      <input type="time" value={schedForm.weekday_end} onChange={(e) => setSchedForm((f) => ({ ...f, weekday_end: e.target.value }))} className="border rounded px-2 py-1 w-full" />
                    </div>
                    <div>
                      <label className="block text-gray-500 mb-1">Weekend start</label>
                      <input type="time" value={schedForm.weekend_start} onChange={(e) => setSchedForm((f) => ({ ...f, weekend_start: e.target.value }))} className="border rounded px-2 py-1 w-full" />
                    </div>
                    <div>
                      <label className="block text-gray-500 mb-1">Weekend end</label>
                      <input type="time" value={schedForm.weekend_end} onChange={(e) => setSchedForm((f) => ({ ...f, weekend_end: e.target.value }))} className="border rounded px-2 py-1 w-full" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Save schedule</button>
                    <button type="button" onClick={() => setEditSched(null)} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">
                    {sched
                      ? `Weekdays ${sched.weekday_start}–${sched.weekday_end} | Weekends ${sched.weekend_start}–${sched.weekend_end}`
                      : "No schedule set"}
                  </span>
                  <button
                    onClick={() => {
                      setEditSched(slug);
                      setSchedForm({
                        weekday_start: sched?.weekday_start ?? "",
                        weekday_end:   sched?.weekday_end   ?? "",
                        weekend_start: sched?.weekend_start ?? "",
                        weekend_end:   sched?.weekend_end   ?? "",
                      });
                    }}
                    className="text-blue-600 hover:underline text-xs"
                  >
                    {sched ? "Edit schedule" : "Add schedule"}
                  </button>
                </div>
              )}
            </div>
          </section>
        );
      })}

      {/* ── Custom rules ── */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-lg font-semibold mb-4">Custom Rules</h2>

        <form onSubmit={addCustom} className="flex gap-3 mb-4">
          <input
            placeholder="Name (optional)"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            className="border rounded px-3 py-2 text-sm w-40"
          />
          <input
            placeholder="domain.com or IP"
            value={customValue}
            onChange={(e) => setCustomValue(e.target.value)}
            required
            className="border rounded px-3 py-2 text-sm flex-1"
          />
          <select
            value={customType}
            onChange={(e) => setCustomType(e.target.value)}
            className="border rounded px-2 py-2 text-sm"
          >
            <option value="domain">Domain</option>
            <option value="ip">IP</option>
          </select>
          <button type="submit" className="px-4 py-2 bg-red-600 text-white text-sm rounded hover:bg-red-700">
            Block
          </button>
        </form>

        <div className="divide-y divide-gray-100">
          {customRules.length === 0 && <p className="text-gray-400 text-sm py-2">No custom rules</p>}
          {customRules.map((r) => (
            <div key={r.id} className="flex items-center justify-between py-2 text-sm">
              <span className="font-medium">{r.name}</span>
              <span className="text-gray-500 font-mono text-xs">{r.value}</span>
              <button onClick={() => deleteRule(r.id)} className="text-red-500 hover:text-red-700 text-xs ml-4">Remove</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
