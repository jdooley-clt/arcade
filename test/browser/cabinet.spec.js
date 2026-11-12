import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Mirrors the <meta http-equiv> policy in index.html; change both together.
const CSP = "default-src 'self'; img-src 'self' data: https://jdooley-clt.github.io; "
  + "frame-src 'self' https://jdooley-clt.github.io; script-src 'self'; style-src 'self'; "
  + "font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'";
const REMOTE_GAMES = "https://jdooley-clt.github.io/**";
const STUB_GAME = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Stub game</title></head>'
  + "<body><main><h1>Stub game</h1><p>Stands in for a remote game while the cabinet is tested.</p>"
  + '<button type="button">Play</button></main></body></html>';

async function watchPage(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      window.__cspViolations.push({
        directive: event.violatedDirective,
        blocked: event.blockedURI,
        source: event.sourceFile,
        line: event.lineNumber,
        sample: event.sample
      });
    });
  });
  return async () => ({
    violations: await page.evaluate(() => window.__cspViolations),
    cspConsole: consoleErrors.filter((text) => /content security policy/i.test(text)),
    pageErrors
  });
}

async function stubRemoteGames(page) {
  await page.route(REMOTE_GAMES, (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: STUB_GAME }));
}

async function openLibrary(page, path = "/") {
  await page.goto(path);
  await expect(page.locator("#catalog-loading")).toBeHidden();
}

async function launchGame(page, id) {
  await page.locator(`#game-grid .game-card[data-game-id="${id}"]`).click();
  const iframe = page.locator("#frame-host iframe");
  await expect(iframe).toHaveCount(1);
  await expect(iframe).toHaveAttribute("src", new RegExp(`^https://jdooley-clt\\.github\\.io/${id}/?$`));
  await expect(page.frameLocator("#frame-host iframe").getByRole("heading", { name: "Stub game" })).toBeVisible();
  return iframe;
}

async function blockingViolations(page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((violation) => ["serious", "critical"].includes(violation.impact))
    .map(({ id, impact, help, nodes }) => ({ id, impact, help, targets: nodes.map((node) => node.target.join(" ")) }));
}

async function expectAccessible(page, state) {
  const found = await blockingViolations(page);
  expect(found, `${state}: ${JSON.stringify(found, null, 2)}`).toEqual([]);
}

test.describe("security posture", () => {
  test("declares the CSP and referrer policy and keeps new-tab links safe", async ({ page }) => {
    await stubRemoteGames(page);
    await openLibrary(page);
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute("content", CSP);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "strict-origin-when-cross-origin");

    const iframe = await launchGame(page, "mona-maze");
    await expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(iframe).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-pointer-lock");
    await expect(iframe).toHaveAttribute("allow", "fullscreen; gamepad");

    const rels = await page.locator('a[target="_blank"]').evaluateAll((links) => links.map((link) => `${link.href} ${link.rel}`));
    expect(rels.length).toBeGreaterThanOrEqual(5);
    for (const entry of rels) {
      expect(entry.split(" ").slice(1), entry).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
    }
  });

  test("launching, playing, reloading, and returning raise zero CSP violations", async ({ page }) => {
    const report = await watchPage(page);
    await stubRemoteGames(page);
    await openLibrary(page);
    await page.locator("#theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await launchGame(page, "mona-maze");
    // mountGame sets --game-height/--mobile-height through the CSSOM; a strict style-src must not block it.
    const heights = await page.locator("#frame-host").evaluate((host) => {
      const style = getComputedStyle(host);
      return [style.getPropertyValue("--game-height").trim(), style.getPropertyValue("--mobile-height").trim()];
    });
    expect(heights).toEqual([expect.stringMatching(/^\d{3,4}px$/), expect.stringMatching(/^\d{3,4}px$/)]);
    expect(await page.locator("#frame-host iframe").boundingBox()).toMatchObject({ height: expect.any(Number) });

    await page.locator("#reload-game").click();
    await expect(page.locator("#frame-host iframe")).toHaveCount(1);
    await expect(page.frameLocator("#frame-host iframe").getByRole("heading", { name: "Stub game" })).toBeVisible();

    await page.locator("#guide-toggle").click();
    await expect(page.locator("#player-guide .game-repo")).toHaveText("Source & credits ↗");
    await page.locator("#focus-button").click();
    await expect(page.locator("#cabinet")).toHaveClass(/is-focused/);
    await page.keyboard.press("Escape");
    await expect(page.locator("#cabinet")).not.toHaveClass(/is-focused/);

    await page.locator("#return-button").click();
    await expect(page.locator("#frame-host iframe")).toHaveCount(0);
    await expect(page.locator("#library")).toBeVisible();
    await expect(page.locator('#game-grid .game-card[data-game-id="mona-maze"]')).toBeFocused();

    expect(await report()).toEqual({ violations: [], cspConsole: [], pageErrors: [] });
  });
});

test.describe("accessibility gate", () => {
  test("library in light and dark themes", async ({ page }) => {
    await stubRemoteGames(page);
    await openLibrary(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("#game-grid .game-card").first()).toBeVisible();
    await expectAccessible(page, "library (light)");

    await page.locator("#theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expectAccessible(page, "library (dark)");
  });

  test("playing screen and focus mode", async ({ page }) => {
    await stubRemoteGames(page);
    await openLibrary(page);
    await launchGame(page, "mona-maze");
    await page.locator("#guide-toggle").click();
    await expect(page.locator("#player-guide")).toBeVisible();
    await expectAccessible(page, "playing screen");

    await page.locator("#focus-button").click();
    await expect(page.locator("#cabinet")).toHaveClass(/is-focused/);
    await expectAccessible(page, "focus mode");
  });

  test("empty and failed catalog states", async ({ page }) => {
    await page.route("**/games.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await openLibrary(page);
    await expect(page.locator("#catalog-notice")).toContainText("This cabinet is empty");
    await expectAccessible(page, "empty catalog");

    await page.unroute("**/games.json");
    await page.route("**/games.json", (route) => route.fulfill({ status: 500, contentType: "text/plain", body: "unavailable" }));
    await openLibrary(page);
    await expect(page.locator("#catalog-error")).toContainText("HTTP 500");
    await expectAccessible(page, "failed catalog");
  });

  test("the gate reports an injected serious violation", async ({ page }) => {
    await stubRemoteGames(page);
    await openLibrary(page);
    await page.locator(".library-heading").evaluate((heading) => {
      const image = document.createElement("img");
      image.src = "./assets/coin.svg";
      const button = document.createElement("button");
      button.type = "button";
      heading.append(image, button);
    });
    const found = await blockingViolations(page);
    expect(found.map((violation) => violation.id)).toEqual(expect.arrayContaining(["image-alt", "button-name"]));
  });
});
