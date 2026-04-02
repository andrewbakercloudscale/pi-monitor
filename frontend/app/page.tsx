"use client";
import { useEffect, useState } from "react";
import { api, Stats, DomainCount, BlockEntry, Rule, DomainDevice } from "@/lib/api";
import StatsCard from "@/components/StatsCard";
import DatePicker from "@/components/DatePicker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, ChevronDown, ChevronUp, Shield } from "lucide-react";

const VPN_ROOTS = [
  "nordvpn.com","expressvpn.com","surfshark.com","mullvad.net",
  "protonvpn.com","windscribe.com","cyberghostvpn.com",
  "privateinternetaccess.com","tunnelbear.com","ipvanish.com",
  "hotspotshield.com","hide.me","zenmate.com","nordvpnteams.com",
  "hidemyass.com","vyprvpn.com","purevpn.com","getlantern.org",
  "psiphon3.com","psiphon.ca",
];

function isVpn(domain: string): boolean {
  return VPN_ROOTS.some((r) => domain === r || domain.endsWith("." + r));
}

function fmtRecent(n: number): string {
  return n > 0 ? n.toLocaleString() : "—";
}

function fmtLastBlocked(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + time;
}

type DeviceMap = Record<string, { loading: boolean; devices: DomainDevice[] }>;

export default function Dashboard() {
  const [date, setDate]       = useState(new Date().toISOString().slice(0, 10));
  const [stats, setStats]     = useState<Stats | null>(null);
  const [traffic, setTraffic] = useState<DomainCount[]>([]);
  const [blocks, setBlocks]   = useState<BlockEntry[]>([]);
  const [rules, setRules]     = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);

  const [blockingDomain, setBlockingDomain]     = useState<string | null>(null);
  const [unblockingDomain, setUnblockingDomain] = useState<string | null>(null);

  // Show Devices expand state — keyed by "traffic:{domain}" or "blocked:{domain}"
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [deviceMap, setDeviceMap] = useState<DeviceMap>({});

  // Device tagging
  const [tagging, setTagging]   = useState<string | null>(null); // client IP
  const [tagValue, setTagValue] = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.all([api.stats(date), api.traffic(date, 20), api.blocks(date, 200), api.rules()])
      .then(([s, t, b, r]) => {
        setStats(s);
        setTraffic(t.domains);
        setBlocks(b.blocks);
        setRules(r.rules);
        // Reset expanded state when date changes
        setExpanded(new Set());
        setDeviceMap({});
      })
      .finally(() => setLoading(false));
  }, [date]);

  function isBlocked(domain: string): boolean {
    return rules.some((r) => r.value === domain && r.is_blocked);
  }

  async function blockDomain(domain: string) {
    setBlockingDomain(domain);
    try {
      const rule = await api.addCustomRule(domain, domain, "domain", "custom", true);
      setRules((rs) => {
        const idx = rs.findIndex((r) => r.value === domain);
        if (idx >= 0) { const copy = [...rs]; copy[idx] = rule; return copy; }
        return [...rs, rule];
      });
    } finally {
      setBlockingDomain(null);
    }
  }

  async function unblockDomain(domain: string) {
    setUnblockingDomain(domain);
    try {
      await api.allowDomain(domain);
      setRules((rs) => rs.map((r) => r.value === domain ? { ...r, is_blocked: 0 } : r));
    } finally {
      setUnblockingDomain(null);
    }
  }

  async function toggleDevices(domain: string, isBlocked: boolean) {
    const key = `${isBlocked ? "blocked" : "traffic"}:${domain}`;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); return next; }
      next.add(key); return next;
    });

    if (!deviceMap[key]) {
      setDeviceMap((m) => ({ ...m, [key]: { loading: true, devices: [] } }));
      try {
        const res = await api.domainDevices(domain, date, isBlocked);
        setDeviceMap((m) => ({ ...m, [key]: { loading: false, devices: res.devices } }));
      } catch {
        setDeviceMap((m) => ({ ...m, [key]: { loading: false, devices: [] } }));
      }
    }
  }

  async function saveTag(mac: string) {
    if (!mac || !tagValue.trim()) return;
    await api.tagDevice(mac, tagValue.trim());
    // Update label in deviceMap
    setDeviceMap((m) => {
      const updated = { ...m };
      for (const key of Object.keys(updated)) {
        updated[key] = {
          ...updated[key],
          devices: updated[key].devices.map((d) =>
            d.mac === mac ? { ...d, label: tagValue.trim() } : d
          ),
        };
      }
      return updated;
    });
    setTagging(null);
    setTagValue("");
  }

  function DeviceRows({ domainKey }: { domainKey: string }) {
    const entry = deviceMap[domainKey];
    if (!expanded.has(domainKey)) return null;
    if (!entry || entry.loading) {
      return (
        <TableRow>
          <TableCell colSpan={10} className="bg-slate-50 py-2">
            <p className="text-xs text-muted-foreground pl-6">Loading devices…</p>
          </TableCell>
        </TableRow>
      );
    }
    if (entry.devices.length === 0) {
      return (
        <TableRow>
          <TableCell colSpan={10} className="bg-slate-50 py-2">
            <p className="text-xs text-muted-foreground pl-6">No device data available</p>
          </TableCell>
        </TableRow>
      );
    }
    return (
      <>
        {entry.devices.map((d) => (
          <TableRow key={d.ip} className="bg-slate-50 hover:bg-slate-100">
            <TableCell colSpan={2} className="py-1.5 pl-10">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono text-muted-foreground">{d.ip}</span>
                {d.mac && <span className="font-mono text-muted-foreground/60">{d.mac}</span>}
                {d.label && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{d.label}</Badge>
                )}
              </div>
            </TableCell>
            <TableCell className="py-1.5 font-mono text-xs text-right text-muted-foreground">{d.count}</TableCell>
            <TableCell colSpan={10} className="py-1.5">
              {d.mac && (
                tagging === d.ip ? (
                  <form
                    onSubmit={(e) => { e.preventDefault(); saveTag(d.mac!); }}
                    className="flex items-center gap-1"
                  >
                    <Input
                      autoFocus
                      value={tagValue}
                      onChange={(e) => setTagValue(e.target.value)}
                      placeholder={`Label for ${d.ip}`}
                      className="h-6 text-xs w-44"
                    />
                    <Button type="submit" size="sm" variant="ghost" className="h-6 text-xs px-2 text-blue-600">Save</Button>
                    <Button type="button" size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setTagging(null)}>✕</Button>
                  </form>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs px-2 text-muted-foreground hover:text-foreground"
                    onClick={() => { setTagging(d.ip); setTagValue(d.label || ""); }}
                  >
                    {d.label ? "Rename" : "Tag device"}
                  </Button>
                )
              )}
            </TableCell>
          </TableRow>
        ))}
      </>
    );
  }

  const vpnAlerts = traffic.filter((d) => isVpn(d.domain));
  const isToday   = date === new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <DatePicker value={date} onChange={setDate} />
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <>
          {vpnAlerts.length > 0 && (
            <Alert variant="destructive" className="border-orange-300 bg-orange-50 text-orange-800">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <AlertTitle className="text-orange-800">VPN / Proxy activity detected</AlertTitle>
              <AlertDescription className="text-orange-700">
                Queries seen to: {vpnAlerts.map((d) => d.domain).join(", ")}
                <br />A VPN can bypass all parental controls. Block it below or in Controls → VPN &amp; Proxy Bypass.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-3 gap-4">
            <StatsCard title="DNS Queries"  value={stats?.queries ?? 0} color="blue"  />
            <StatsCard title="Blocks"       value={stats?.blocks  ?? 0} color="red"   />
            <StatsCard title="Devices Seen" value={stats?.devices ?? 0} color="green" />
          </div>

          {/* Top Domains */}
          <Card>
            <CardHeader className="pb-2">
              <h2 className="text-base font-semibold text-muted-foreground">Top Domains</h2>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs uppercase tracking-wide">Domain</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wide">Total</TableHead>
                    {isToday && <>
                      <TableHead className="text-right text-xs uppercase tracking-wide">1 min</TableHead>
                      <TableHead className="text-right text-xs uppercase tracking-wide">5 min</TableHead>
                      <TableHead className="text-right text-xs uppercase tracking-wide">10 min</TableHead>
                      <TableHead className="text-right text-xs uppercase tracking-wide">30 min</TableHead>
                    </>}
                    <TableHead className="text-right text-xs uppercase tracking-wide">Blocked</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wide">Last Blocked</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide w-24">Devices</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {traffic.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={isToday ? 10 : 6} className="text-muted-foreground text-sm text-center py-4">No data</TableCell>
                    </TableRow>
                  )}
                  {traffic.map((d) => {
                    const blocked    = isBlocked(d.domain);
                    const isVpnHost  = isVpn(d.domain);
                    const inProgress = blockingDomain === d.domain;
                    const key        = `traffic:${d.domain}`;
                    const isOpen     = expanded.has(key);
                    const blockEntry = blocks.find((b) => b.domain === d.domain);
                    return (
                      <>
                        <TableRow key={d.domain} className={isVpnHost ? "bg-orange-50" : ""}>
                          <TableCell className={`font-mono text-xs truncate max-w-[200px] ${isVpnHost ? "text-orange-700 font-semibold" : ""}`}>
                            {isVpnHost && "🔒 "}{d.domain}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-right text-muted-foreground">{d.count.toLocaleString()}</TableCell>
                          {isToday && <>
                            <TableCell className="font-mono text-xs text-right text-blue-600">{fmtRecent(d.count_1m)}</TableCell>
                            <TableCell className="font-mono text-xs text-right text-blue-500">{fmtRecent(d.count_5m)}</TableCell>
                            <TableCell className="font-mono text-xs text-right text-blue-400">{fmtRecent(d.count_10m)}</TableCell>
                            <TableCell className="font-mono text-xs text-right text-blue-300">{fmtRecent(d.count_30m)}</TableCell>
                          </>}
                          {!isToday && <TableCell colSpan={4} />}
                          <TableCell className="font-mono text-xs text-right text-red-500">
                            {blockEntry ? blockEntry.count.toLocaleString() : "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-right text-muted-foreground whitespace-nowrap">
                            {blockEntry?.last_at ? fmtLastBlocked(blockEntry.last_at) : "—"}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs px-1.5 text-muted-foreground hover:text-foreground"
                              onClick={() => toggleDevices(d.domain, false)}
                            >
                              {isOpen ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
                              Devices
                            </Button>
                          </TableCell>
                          <TableCell>
                            {blocked ? (
                              <Badge variant="destructive" className="text-xs h-5 px-1.5 bg-red-50 text-red-400 border-red-200 hover:bg-red-50">
                                <Shield className="w-3 h-3 mr-1" />Blocked
                              </Badge>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 text-xs px-2"
                                onClick={() => blockDomain(d.domain)}
                                disabled={inProgress}
                              >
                                {inProgress ? "…" : "Block"}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                        <DeviceRows domainKey={key} />
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Blocked Domains */}
          <Card>
            <CardHeader className="pb-2">
              <h2 className="text-base font-semibold text-muted-foreground">Blocked Domains</h2>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs uppercase tracking-wide">Domain</TableHead>
                    <TableHead className="text-right text-xs uppercase tracking-wide">Count</TableHead>
                    <TableHead className="text-xs uppercase tracking-wide w-24">Devices</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {blocks.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-muted-foreground text-sm text-center py-4">No blocks today</TableCell>
                    </TableRow>
                  )}
                  {blocks.map((b) => {
                    const inProgress = unblockingDomain === b.domain;
                    const key        = `blocked:${b.domain}`;
                    const isOpen     = expanded.has(key);
                    return (
                      <>
                        <TableRow key={b.domain}>
                          <TableCell className="truncate text-red-700 font-mono text-xs max-w-[260px]">{b.domain}</TableCell>
                          <TableCell className="font-mono text-muted-foreground text-xs text-right">{b.count.toLocaleString()}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs px-1.5 text-muted-foreground hover:text-foreground"
                              onClick={() => toggleDevices(b.domain, true)}
                            >
                              {isOpen ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
                              Devices
                            </Button>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-xs px-2 border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                              onClick={() => unblockDomain(b.domain)}
                              disabled={inProgress}
                            >
                              {inProgress ? "…" : "Allow"}
                            </Button>
                          </TableCell>
                        </TableRow>
                        <DeviceRows domainKey={key} />
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
