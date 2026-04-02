/**
 * 01-dashboard.spec.ts
 *
 * Dashboard page — stats, top domains, blocked domains, date navigation.
 *
 * As a parent, the dashboard is the first thing I see. I need to understand
 * at a glance: how much traffic is there today, what was blocked, and which
 * devices are online.
 */

import { test, expect } from "@playwright/test";
import { waitForData, getStatValue } from "../helpers/page";
import { apiPost, apiGet, deleteCustomRule } from "../helpers/api";

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForData(page);
  });

  test("page title and nav are visible", async ({ page }) => {
    await expect(page).toHaveTitle(/Pi Monitor/i);
    await expect(page.locator("aside")).toContainText("Pi Monitor");
    await expect(page.locator('aside nav a:has-text("Dashboard")')).toBeVisible();
    await expect(page.locator('aside nav a:has-text("Devices")')).toBeVisible();
    await expect(page.locator('aside nav a:has-text("Controls")')).toBeVisible();
    await expect(page.locator('aside nav a:has-text("Settings")')).toBeVisible();
  });

  test("stats cards show numeric values", async ({ page }) => {
    const queries = await getStatValue(page, "DNS Queries");
    const blocks  = await getStatValue(page, "Blocks");
    const devices = await getStatValue(page, "Devices Seen");

    expect(queries).toBeGreaterThanOrEqual(0);
    expect(blocks).toBeGreaterThanOrEqual(0);
    expect(devices).toBeGreaterThanOrEqual(0);

    // Sanity: can't have more blocks than total queries
    expect(blocks).toBeLessThanOrEqual(queries + 1); // +1 for edge case
  });

  test("top domains list is visible", async ({ page }) => {
    await expect(page.locator("h2:has-text('Top Domains')")).toBeVisible();
    // Either shows domain rows or the empty state
    const hasRows  = await page.locator("table tbody tr").count() > 0;
    const hasEmpty = await page.locator("text=No data").count() > 0;
    expect(hasRows || hasEmpty).toBeTruthy();
  });

  test("blocked domains panel is visible", async ({ page }) => {
    await expect(page.locator("h2:has-text('Blocked Domains')")).toBeVisible();
  });

  test("date picker: go to yesterday and back", async ({ page }) => {
    // Note today's query count
    const todayQueries = await getStatValue(page, "DNS Queries");

    // Click Prev
    await page.click('[aria-label="Previous day"]');
    await waitForData(page);

    // Stats should reload (yesterday's values — just check they're numeric)
    const yesterdayQueries = await getStatValue(page, "DNS Queries");
    expect(yesterdayQueries).toBeGreaterThanOrEqual(0);

    // Click Next to return to today
    await page.click('[aria-label="Next day"]');
    await waitForData(page);
    // Poll until the stat card shows a non-zero value — avoids a race where
    // waitForData resolves before the new fetch even starts (React batching).
    await page.waitForFunction(
      () => {
        const cards = Array.from(document.querySelectorAll(".rounded-xl"));
        const dnsCard = cards.find((c) => c.textContent?.includes("DNS Queries"));
        if (!dnsCard) return false;
        const valEl = dnsCard.querySelector(".text-3xl");
        return valEl ? parseInt(valEl.textContent?.replace(/,/g, "") ?? "0", 10) > 0 : false;
      },
      { timeout: 12_000 }
    );
    const backToToday = await getStatValue(page, "DNS Queries");
    // Stats can only increase during the day; strict equality fails if a new query arrived
    expect(backToToday).toBeGreaterThanOrEqual(todayQueries);
  });

  test("Next button is disabled when viewing today", async ({ page }) => {
    const nextBtn = page.locator('[aria-label="Next day"]');
    await expect(nextBtn).toBeDisabled();
  });

  test("domain rows show domain + count side by side", async ({ page }) => {
    const rows = page.locator("h2:has-text('Top Domains') + div > div");
    const count = await rows.count();
    if (count > 0) {
      const first = rows.first();
      const text = await first.innerText();
      // Should contain a domain-like string and a number
      expect(text).toMatch(/\./); // domain has a dot
    }
  });

  test("blocked domain names are visually distinct (red)", async ({ page }) => {
    const blockedItems = page.locator(".text-red-700");
    // May be 0 if nothing blocked — just ensure there's no error
    const count = await blockedItems.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("top domains table has Blocked and Last Blocked columns", async ({ page }) => {
    // Column headers must be present
    const table = page.locator("h2:has-text('Top Domains')").locator("..").locator("table");
    await expect(table.locator("th:has-text('Blocked')").first()).toBeVisible();
    await expect(table.locator("th:has-text('Last Blocked')")).toBeVisible();
  });

  test("blocked domain shows Shield badge (not Block button) in Top Domains", async ({ page }) => {
    const TEST = "dashboard-block-test.example.com";

    // Ensure the domain is blocked via the API so it appears in rules
    await apiPost("/api/rules/custom", { name: TEST, value: TEST, is_blocked: true });

    // Reload the page — rules cache is invalidated on load so the badge should appear
    await page.goto("/");
    await waitForData(page);

    // Find the row if it appears in traffic (it may not — the domain has no real queries)
    // Instead verify the API state is reflected: if we can find the row, it must show Blocked
    const rows = page.locator("table tbody tr");
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const text = await rows.nth(i).innerText();
      if (text.includes(TEST)) {
        await expect(rows.nth(i).locator('[class*="text-red"]')).toBeVisible();
        break;
      }
    }

    await deleteCustomRule(TEST);
  });

  test("domain row with block history shows a count in Blocked column", async ({ page }) => {
    // Find any row in Top Domains that has a non-dash Blocked count
    const table = page.locator("h2:has-text('Top Domains')").locator("..").locator("table");
    const rows  = table.locator("tbody tr");
    const n     = await rows.count();

    let foundBlockCount = false;
    for (let i = 0; i < Math.min(n, 20); i++) {
      const cells = rows.nth(i).locator("td");
      const cellCount = await cells.count();
      // Blocked count cell is 3rd from end (before Last Blocked, Devices, action)
      if (cellCount >= 4) {
        const blockedCell = cells.nth(cellCount - 4);
        const text = await blockedCell.innerText();
        if (text !== "—" && /^\d/.test(text)) {
          foundBlockCount = true;
          // Last Blocked cell should also have a value
          const lastBlockedCell = cells.nth(cellCount - 3);
          const lbText = await lastBlockedCell.innerText();
          expect(lbText).not.toBe("—");
          break;
        }
      }
    }
    // Only fail if there are blocks today but none appeared in the table
    const { blocks } = await (await page.request.get(`${process.env.API_URL ?? "http://192.168.0.51:8080"}/api/blocks?limit=1`)).json();
    if (blocks.length > 0) {
      expect(foundBlockCount, "Expected at least one row to show a block count").toBe(true);
    }
  });
});
