/**
 * 02-devices.spec.ts
 *
 * Devices page — list, rename, drill into a device's history.
 *
 * As a parent, I need to:
 *   - See ALL devices on my network (especially unknown ones)
 *   - Name them so I know whose device is whose
 *   - Click into a device to see exactly what it was browsing
 */

import { test, expect } from "@playwright/test";
import { waitForData } from "../helpers/page";
import { apiPatch } from "../helpers/api";

const TEST_DEVICE_LABEL = "Test Device (playwright)";
const RESTORE_LABEL     = ""; // Will be filled in during test

test.describe("Devices", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/devices/");
    await waitForData(page);
  });

  test("device list table is visible with column headers", async ({ page }) => {
    const headers = page.locator("thead th");
    await expect(headers).toHaveCount(7);
    await expect(headers.nth(0)).toContainText("Device");
    await expect(headers.nth(1)).toContainText("MAC");
    await expect(headers.nth(2)).toContainText("IP");
    await expect(headers.nth(3)).toContainText("OS");
    await expect(headers.nth(4)).toContainText("Queries");
    await expect(headers.nth(5)).toContainText("Blocks");
  });

  test("at least one device is visible", async ({ page }) => {
    const rows = page.locator("tbody tr");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // Each row should have a MAC address (xx:xx:xx:xx:xx:xx format)
    const firstRow = rows.first();
    const macCell  = firstRow.locator("td:nth-child(2)");
    await expect(macCell).toBeVisible();
    const mac = await macCell.innerText();
    expect(mac).toMatch(/([0-9a-f]{2}:){5}[0-9a-f]{2}/i);
  });

  test("query and block counts are numeric", async ({ page }) => {
    const rows = page.locator("tbody tr");
    const count = await rows.count();
    if (count === 0) test.skip();

    const queryCell = rows.first().locator("td:nth-child(5)");
    const blockCell = rows.first().locator("td:nth-child(6)");
    const queryText = await queryCell.innerText();
    const blockText = await blockCell.innerText();

    expect(Number(queryText.replace(/,/g, ""))).toBeGreaterThanOrEqual(0);
    expect(Number(blockText.replace(/,/g, ""))).toBeGreaterThanOrEqual(0);
  });

  test("clicking Detail opens device detail page", async ({ page }) => {
    const detailLink = page.locator("a:has-text('Detail')").first();
    await expect(detailLink).toBeVisible();
    await detailLink.click();
    await page.waitForURL("**/devices/detail/**");
    await expect(page.locator("h1")).toContainText("Device Detail");
  });

  test("inline rename: can rename a device and save", async ({ page }) => {
    const rows = page.locator("tbody tr");
    if (await rows.count() === 0) test.skip();

    // Click the device name to enter edit mode
    const nameCell = rows.first().locator("span.cursor-pointer");
    const originalName = await nameCell.innerText();
    await nameCell.click();

    // Input should appear
    const input = rows.first().locator("input");
    await expect(input).toBeVisible();
    await input.fill(TEST_DEVICE_LABEL);
    await rows.first().locator('button[type="submit"]').click();

    // Name should update in the table
    await expect(rows.first().locator("span.cursor-pointer")).toContainText(TEST_DEVICE_LABEL);

    // Restore original name via API so we don't pollute state
    const mac = await rows.first().locator("td:nth-child(2)").innerText();
    if (mac && originalName !== TEST_DEVICE_LABEL) {
      await apiPatch(`/api/devices/${mac.trim()}`, { label: originalName });
    }
  });

  test("inline rename: can cancel without saving", async ({ page }) => {
    const rows = page.locator("tbody tr");
    if (await rows.count() === 0) test.skip();

    const nameCell = rows.first().locator("span.cursor-pointer");
    const originalName = await nameCell.innerText();
    await nameCell.click();

    await rows.first().locator("input").fill("Should not save");
    await rows.first().locator('button:has-text("Cancel")').click();

    // Name should be unchanged
    await expect(rows.first().locator("span.cursor-pointer")).toContainText(originalName);
  });
});

test.describe("Device Detail", () => {
  test("shows queries and blocks panels", async ({ page }) => {
    // Navigate via the devices list
    await page.goto("/devices/");
    await waitForData(page);
    await page.locator("a:has-text('Detail')").first().click();
    await page.waitForURL("**/devices/detail/**");
    await waitForData(page);

    await expect(page.locator("h2").filter({ hasText: /Queries/ })).toBeVisible();
    await expect(page.locator("h2").filter({ hasText: /Blocks/ })).toBeVisible();
  });

  test("MAC address is shown in page subtitle", async ({ page }) => {
    await page.goto("/devices/");
    await waitForData(page);

    const mac = await page.locator("tbody tr:first-child td:nth-child(2)").innerText();
    await page.locator("a:has-text('Detail')").first().click();
    await waitForData(page);

    await expect(page.locator("p.font-mono")).toContainText(mac.trim());
  });

  test("date picker: navigate to yesterday on device detail", async ({ page }) => {
    await page.goto("/devices/");
    await waitForData(page);
    await page.locator("a:has-text('Detail')").first().click();
    await waitForData(page);

    await page.click('[aria-label="Previous day"]');
    await waitForData(page);

    // Headers still visible after navigation
    await expect(page.locator("h2").filter({ hasText: /Queries/ })).toBeVisible();
  });

  test("empty state is shown gracefully if no data", async ({ page }) => {
    // Navigate to an old date that likely has no data
    await page.goto("/devices/");
    await waitForData(page);
    await page.locator("a:has-text('Detail')").first().click();
    await waitForData(page);

    // Go back 30 days
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 30);
    const dateStr = oldDate.toISOString().slice(0, 10);
    await page.locator('input[type="date"]').fill(dateStr);
    await page.locator('input[type="date"]').press("Tab");
    await waitForData(page);

    // Should show "No queries" or actual data — not an error
    const hasNoQueries = await page.locator("text=No queries").count() > 0;
    const hasRows      = await page.locator("table tbody tr").count() > 0;
    expect(hasNoQueries || hasRows).toBeTruthy();
  });
});
