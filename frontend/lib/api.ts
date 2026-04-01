const BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api.pi.andrewbaker.ninja";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface Stats {
  queries: number;
  blocks: number;
  devices: number;
  date: string;
}

export interface Device {
  mac: string;
  label: string;
  last_ip: string;
  queries_today: number;
  blocks_today: number;
}

export interface DomainCount {
  domain: string;
  count: number;
}

export interface BlockEntry extends DomainCount {
  last_at: string;
}

export interface Rule {
  id: number;
  name: string;
  category: string;
  service_key: string;
  rule_type: string;
  value: string;
  is_blocked: number;
  is_custom: number;
}

export interface Schedule {
  id: number;
  scope_type: string;
  scope_key: string;
  weekday_start: string | null;
  weekday_end: string | null;
  weekend_start: string | null;
  weekend_end: string | null;
  enabled: number;
}

export interface CategoryMeta {
  label: string;
  services: Record<string, string>;
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const api = {
  ping: () => apiFetch<{ ok: boolean }>("/api/ping"),

  stats: (date?: string) =>
    apiFetch<Stats>(`/api/stats${date ? `?date=${date}` : ""}`),

  devices: () => apiFetch<{ devices: Device[] }>("/api/devices"),

  updateDevice: (mac: string, label: string) =>
    apiFetch<{ ok: boolean }>(`/api/devices/${mac}`, {
      method: "PATCH",
      body: JSON.stringify({ label }),
    }),

  deviceTraffic: (mac: string, date?: string) =>
    apiFetch<{ mac: string; queries: DomainCount[]; blocks: BlockEntry[] }>(
      `/api/devices/${mac}/traffic${date ? `?date=${date}` : ""}`
    ),

  traffic: (date?: string, limit = 50) =>
    apiFetch<{ domains: DomainCount[] }>(
      `/api/traffic?limit=${limit}${date ? `&date=${date}` : ""}`
    ),

  blocks: (date?: string, limit = 50) =>
    apiFetch<{ blocks: BlockEntry[] }>(
      `/api/blocks?limit=${limit}${date ? `&date=${date}` : ""}`
    ),

  rules: (category?: string) =>
    apiFetch<{ rules: Rule[]; categories: Record<string, CategoryMeta> }>(
      `/api/rules${category ? `?category=${category}` : ""}`
    ),

  toggleRule: (id: number) =>
    apiFetch<{ id: number; is_blocked: number }>(`/api/rules/${id}/toggle`, {
      method: "POST",
    }),

  toggleCategory: (slug: string) =>
    apiFetch<{ category: string; is_blocked: number; errors: string[] }>(
      `/api/categories/${slug}/toggle`,
      { method: "POST" }
    ),

  addCustomRule: (name: string, value: string, rule_type = "domain") =>
    apiFetch<Rule>("/api/rules/custom", {
      method: "POST",
      body: JSON.stringify({ name, value, rule_type }),
    }),

  deleteRule: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/rules/${id}`, { method: "DELETE" }),

  schedules: () => apiFetch<{ schedules: Schedule[] }>("/api/schedules"),

  upsertSchedule: (data: Omit<Schedule, "id">) =>
    apiFetch<Schedule>("/api/schedules", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  deleteSchedule: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/schedules/${id}`, { method: "DELETE" }),
};
