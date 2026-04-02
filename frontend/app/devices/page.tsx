"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Device } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ProbeResult {
  ip: string;
  os_guess: string;
  os_matches: string[];
  open_ports: string[];
}

export default function DevicesPage() {
  const [devices, setDevices]   = useState<Device[]>([]);
  const [editing, setEditing]   = useState<string | null>(null);
  const [draft, setDraft]       = useState("");
  const [loading, setLoading]   = useState(true);
  const [probing, setProbing]   = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<Record<string, ProbeResult>>({});

  useEffect(() => {
    api.devices().then((r) => setDevices(r.devices)).finally(() => setLoading(false));
  }, []);

  async function saveLabel(mac: string) {
    await api.updateDevice(mac, draft);
    setDevices((ds) => ds.map((d) => d.mac === mac ? { ...d, label: draft } : d));
    setEditing(null);
  }

  async function probeDevice(mac: string) {
    setProbing(mac);
    try {
      const res = await fetch(`/api/devices/${mac}/probe`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setProbeResults((prev) => ({ ...prev, [mac]: data }));
    } catch (e) {
      setProbeResults((prev) => ({ ...prev, [mac]: { ip: "", os_guess: "Probe failed", os_matches: [], open_ports: [] } }));
    } finally {
      setProbing(null);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Devices</h1>

      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs uppercase tracking-wider">Device</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">MAC</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">IP</TableHead>
                  <TableHead className="text-xs uppercase tracking-wider">OS / Type</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider">Queries</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-wider">Blocks</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((d) => {
                  const result = probeResults[d.mac];
                  return (
                    <TableRow key={d.mac}>
                      <TableCell>
                        {editing === d.mac ? (
                          <form onSubmit={(e) => { e.preventDefault(); saveLabel(d.mac); }} className="flex gap-2 items-center">
                            <Input
                              autoFocus
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              className="h-7 text-sm w-40"
                            />
                            <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs text-blue-600 px-2">Save</Button>
                            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => setEditing(null)}>Cancel</Button>
                          </form>
                        ) : (
                          <span
                            className="cursor-pointer hover:underline font-medium"
                            onClick={() => { setEditing(d.mac); setDraft(d.label || d.mac); }}
                          >
                            {d.label || d.mac}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground text-sm">{d.mac}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{d.last_ip}</TableCell>
                      <TableCell className="text-sm">
                        {result ? (
                          <div>
                            <span className={result.os_guess === "Could not determine" || result.os_guess === "Probe failed" ? "text-muted-foreground" : "text-foreground"}>
                              {result.os_guess}
                            </span>
                            {result.open_ports.length > 0 && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {result.open_ports.slice(0, 3).map(p => p.split(/\s+/)[0]).join(", ")}
                                {result.open_ports.length > 3 && ` +${result.open_ports.length - 3} more`}
                              </div>
                            )}
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 text-xs px-2"
                            disabled={probing === d.mac}
                            onClick={() => probeDevice(d.mac)}
                          >
                            {probing === d.mac ? "Probing…" : "Probe Device"}
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary" className="font-mono text-xs">{d.queries_today.toLocaleString()}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="destructive" className="font-mono text-xs bg-red-50 text-red-600 border-red-200 hover:bg-red-50">{d.blocks_today.toLocaleString()}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/devices/detail?mac=${d.mac}`} className="text-blue-600 text-xs hover:underline">
                          Detail →
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {devices.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">No devices seen yet</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
