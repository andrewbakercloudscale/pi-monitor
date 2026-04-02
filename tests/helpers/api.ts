/**
 * helpers/api.ts — Direct API helpers for test setup/teardown.
 * Used to create known state before tests run.
 */

// Use local Pi IP by default so test setup/teardown bypasses Cloudflare.
// Cloudflare serves HTML challenge pages to headless Node.js fetch.
// Override with API_URL=https://api-pi.andrewbaker.ninja for remote-only testing.
const API = process.env.API_URL ?? "http://YOUR-PI-LAN-IP:8080";

export async function apiGet(path: string) {
  const r = await fetch(`${API}${path}`);
  return r.json();
}

export async function apiPost(path: string, body?: unknown) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

export async function apiPatch(path: string, body: unknown) {
  const r = await fetch(`${API}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function apiDelete(path: string) {
  const r = await fetch(`${API}${path}`, { method: "DELETE" });
  return r.json();
}

/** Ensure a rule is in a known state before a test. */
export async function ensureRuleBlocked(domain: string, blocked: boolean) {
  const { rules } = await apiGet("/api/rules");
  const rule = rules.find((r: { value: string }) => r.value === domain);
  if (!rule) return;
  if (Boolean(rule.is_blocked) !== blocked) {
    await apiPost(`/api/rules/${rule.id}/toggle`);
    // Wait for Pi-hole to propagate the change before the next test loads the page
    await new Promise((r) => setTimeout(r, 3000));
  }
}

/** Ensure a category is in a known state. */
export async function ensureCategoryUnblocked(category: string) {
  const { rules } = await apiGet(`/api/rules?category=${category}`);
  const allBlocked  = rules.length > 0 && rules.every((r: { is_blocked: number }) => r.is_blocked);
  const anyBlocked  = rules.some((r: { is_blocked: number }) => r.is_blocked);
  if (!anyBlocked) return;
  if (allBlocked) {
    // One toggle call unblocks all
    await apiPost(`/api/categories/${category}/toggle`);
  } else {
    // Partially blocked — unblock each individually so toggle doesn't flip to "all blocked"
    for (const rule of rules.filter((r: { is_blocked: number }) => r.is_blocked)) {
      await apiPost(`/api/rules/${rule.id}/toggle`);
    }
  }
  // Wait for Pi-hole to propagate the change before the next test loads the page
  await new Promise((r) => setTimeout(r, 3000));
}

/** Clean up any custom rules with a given value. */
export async function deleteCustomRule(value: string) {
  const { rules } = await apiGet("/api/rules");
  const rule = rules.find(
    (r: { value: string; is_custom: number }) => r.value === value && r.is_custom
  );
  if (rule) await apiDelete(`/api/rules/${rule.id}`);
}
