// Live smoke: opens the published cabinet, launches every catalog game, waits
// for the game to present its start or play UI, and returns to the library.
// Runs from playwright.live.config.js only; the PR gate ignores this file.
import { test, expect } from "@playwright/test";

const GAME_ORIGIN = "https://jdooley-clt.github.io/";

async function openLibrary(page) {
  await page.goto("./", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#catalog-loading")).toBeHidden();
  await expect(page.locator("#game-grid .game-card[data-game-id]").first()).toBeVisible();
}

test("the live cabinet serves its library", async ({ page }) => {
  await openLibrary(page);
  await expect(page).toHaveTitle("GitHub Arcade — The Commit Cabinet");
  await expect(page.locator("#catalog-notice")).toBeHidden();
  expect(await page.locator("#game-grid .game-card[data-game-id]").count()).toBeGreaterThan(0);
});

test("every catalog game launches from the live cabinet and returns to the library", async ({ page }) => {
  await openLibrary(page);
  const ids = await page.locator("#game-grid .game-card[data-game-id]").evaluateAll((cards) => cards.map((card) => card.dataset.gameId));
  const failures = [];

  for (const id of ids) {
    await test.step(`launch ${id}`, async () => {
      try {
        await page.locator(`#game-grid .game-card[data-game-id="${id}"]`).click();
        await expect(page).toHaveURL((url) => url.hash === `#game/${id}`);
        const iframe = page.locator("#frame-host iframe");
        await expect(iframe).toHaveCount(1);
        const src = await iframe.getAttribute("src");
        expect(src?.startsWith(GAME_ORIGIN), `${id} embeds a jdooley-clt page, got ${src}`).toBe(true);
        await expect(page.locator("#open-game")).toHaveAttribute("href", src);

        // A GitHub Pages 404 has a title but neither a canvas nor a button; a game shows at least one.
        const game = page.frameLocator("#frame-host iframe");
        await expect(game.locator("canvas, button, [role=button]").first()).toBeVisible({ timeout: 60_000 });
        const frame = page.frames().find((candidate) => candidate.url() === src || candidate.url().startsWith(src));
        expect(frame, `${id} frame is attached`).toBeTruthy();
        await expect.poll(() => frame.evaluate(() => document.readyState)).toBe("complete");
        const title = await frame.title();
        expect(title, `${id} page title`).not.toMatch(/not found|404/i);

        await page.locator("#return-button").click();
        await expect(page.locator("#frame-host iframe")).toHaveCount(0);
        await expect(page.locator(`#game-grid .game-card[data-game-id="${id}"]`)).toBeVisible();
      } catch (error) {
        failures.push(`${id}: ${String(error.message).split("\n")[0]}`);
        await page.goto("./#library", { waitUntil: "domcontentloaded" }).catch(() => {});
        await expect(page.locator("#catalog-loading")).toBeHidden().catch(() => {});
      }
    });
  }

  expect(failures, failures.join("\n")).toEqual([]);
});
