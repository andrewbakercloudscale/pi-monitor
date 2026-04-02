// Use empty string (relative URL) so API calls go to the same host via nginx proxy.
// This means pi.andrewbaker.ninja/api/* proxies to FastAPI on port 8080.
// Override with NEXT_PUBLIC_API_URL for standalone API setups.
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

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

// ── localStorage cache ────────────────────────────────────────────────────────
// Caches static-ish data (rules/categories) so the Controls page renders
// instantly on repeat visits, then refreshes in background.

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function cacheGet<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return data as T;
  } catch { return null; }
}

function cacheSet(key: string, data: unknown) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch {}
}

function cacheInvalidate(key: string) {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(key); } catch {}
}

async function cachedFetch<T>(cacheKey: string, path: string): Promise<T> {
  const cached = cacheGet<T>(cacheKey);
  // Always fetch fresh in background
  const fresh = apiFetch<T>(path).then(data => { cacheSet(cacheKey, data); return data; });
  // Return cache immediately if available, otherwise wait for network
  return cached ?? fresh;
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
  count_1m: number;
  count_5m: number;
  count_10m: number;
  count_30m: number;
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
  unblock_at: string | null;  // blocked temporarily; auto-unblocks at this time
  reblock_at: string | null;  // allowed temporarily; auto-reblocks at this time
}

export interface DomainDevice {
  ip: string;
  count: number;
  mac: string | null;
  hostname: string;
  label: string;
}

export interface TimeWindow {
  days: number[];   // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  start: string;    // "HH:MM"
  end: string;      // "HH:MM"
}

export interface Schedule {
  id: number;
  scope_type: string;
  scope_key: string;
  windows: TimeWindow[];
  enabled: number | boolean;
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
      category ? `/api/rules?category=${category}` : "/api/rules"
    ),

  invalidateRules: () => cacheInvalidate("cache:rules"),

  toggleRule: (id: number) =>
    apiFetch<{ id: number; is_blocked: number }>(`/api/rules/${id}/toggle`, {
      method: "POST",
    }),

  toggleCategory: (slug: string) =>
    apiFetch<{ category: string; is_blocked: number; errors: string[] }>(
      `/api/categories/${slug}/toggle`,
      { method: "POST" }
    ),

  addCustomRule: (
    name: string,
    value: string,
    rule_type = "domain",
    category = "custom",
    is_blocked = false,
    service_key?: string,
  ) =>
    apiFetch<Rule>("/api/rules/custom", {
      method: "POST",
      body: JSON.stringify({ name, value, rule_type, category, is_blocked, service_key }),
    }),

  blockRuleFor: (id: number, minutes: number) =>
    apiFetch<{ id: number; is_blocked: number; unblock_at: string }>(
      `/api/rules/${id}/block-for`,
      { method: "POST", body: JSON.stringify({ minutes }) }
    ),

  allowRuleFor: (id: number, minutes: number) =>
    apiFetch<{ id: number; is_blocked: number; reblock_at: string }>(
      `/api/rules/${id}/allow-for`,
      { method: "POST", body: JSON.stringify({ minutes }) }
    ),

  blockCategoryFor: (slug: string, minutes: number) =>
    apiFetch<{ category: string; is_blocked: number; unblock_at: string }>(
      `/api/categories/${slug}/block-for`,
      { method: "POST", body: JSON.stringify({ minutes }) }
    ),

  allowCategoryFor: (slug: string, minutes: number) =>
    apiFetch<{ category: string; is_blocked: number; reblock_at: string }>(
      `/api/categories/${slug}/allow-for`,
      { method: "POST", body: JSON.stringify({ minutes }) }
    ),

  blockServiceFor: (serviceKey: string, minutes: number) =>
    apiFetch<{ service_key: string; is_blocked: number; unblock_at: string }>(
      `/api/services/${serviceKey}/block-for`,
      { method: "POST", body: JSON.stringify({ minutes }) }
    ),

  allowServiceFor: (serviceKey: string, minutes: number) =>
    apiFetch<{ service_key: string; is_blocked: number; reblock_at: string }>(
      `/api/services/${serviceKey}/allow-for`,
      { method: "POST", body: JSON.stringify({ minutes }) }
    ),

  getDnsTtl: () =>
    apiFetch<{ ttl: number }>("/api/settings/dns-ttl"),

  setDnsTtl: (ttl: number) =>
    apiFetch<{ ttl: number }>("/api/settings/dns-ttl", {
      method: "POST",
      body: JSON.stringify({ ttl }),
    }),

  probeDevice: (mac: string) =>
    apiFetch<{ mac: string; ip: string; os_guess: string; os_matches: string[]; open_ports: string[] }>(
      `/api/devices/${mac}/probe`,
      { method: "POST" }
    ),

  deleteRule: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/rules/${id}`, { method: "DELETE" }),

  domainDevices: (domain: string, date?: string, blocked = false) =>
    apiFetch<{ devices: DomainDevice[] }>(
      `/api/domain-devices?domain=${encodeURIComponent(domain)}${date ? `&date=${date}` : ""}&blocked=${blocked}`
    ),

  tagDevice: (mac: string, label: string) =>
    apiFetch<{ ok: boolean; mac: string; label: string }>(`/api/devices/${mac}`, {
      method: "PATCH",
      body: JSON.stringify({ label }),
    }),

  schedules: () => cachedFetch<{ schedules: Schedule[] }>("cache:schedules", "/api/schedules"),

  invalidateSchedules: () => cacheInvalidate("cache:schedules"),

  upsertSchedule: (data: { scope_type: string; scope_key: string; windows: TimeWindow[]; enabled: boolean }) =>
    apiFetch<Schedule>("/api/schedules", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  allowDomain: (domain: string) =>
    apiFetch<{ ok: boolean; domain: string }>("/api/domains/allow", {
      method: "POST",
      body: JSON.stringify({ domain }),
    }),

  deleteSchedule: (id: number) =>
    apiFetch<{ ok: boolean }>(`/api/schedules/${id}`, { method: "DELETE" }),
};
