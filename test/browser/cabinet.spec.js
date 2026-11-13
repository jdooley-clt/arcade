import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const catalog = JSON.parse(readFileSync(new URL("../../games.json", import.meta.url), "utf8"));

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

// Every severity counts: moderate items such as duplicate landmark names are real defects too.
async function axeViolations(page) {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .map(({ id, impact, help, nodes }) => ({ id, impact, help, targets: nodes.map((node) => node.target.join(" ")) }));
}

async function expectAccessible(page, state) {
  const found = await axeViolations(page);
  expect(found, `${state}: ${JSON.stringify(found, null, 2)}`).toEqual([]);
}

function describeElement(el) {
  const classes = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
  return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${classes}`;
}

// WCAG 2.5.8: pointer targets need 24x24 CSS px unless they sit inline in a sentence.
async function undersizedTargets(page) {
  return page.evaluate((describeSource) => {
    const describe = new Function(`return (${describeSource})`)();
    const found = [];
    for (const el of document.querySelectorAll('a[href], button, input, [tabindex]:not([tabindex="-1"])')) {
      if (el.disabled) continue;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      // Visually hidden controls (the 1 px skip link before focus) are not pointer targets.
      if (rect.width <= 1 || rect.height <= 1 || style.visibility === "hidden") continue;
      if (rect.width >= 24 && rect.height >= 24) continue;
      const inSentence = style.display === "inline"
        && Array.from(el.parentElement.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      if (inSentence) continue;
      found.push({ target: describe(el), width: Math.round(rect.width), height: Math.round(rect.height) });
    }
    return found;
  }, describeElement.toString());
}

// Scroll containers must never need horizontal scrolling (WCAG 1.4.10 at 320 CSS px).
async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const found = [];
    for (const el of [document.documentElement, document.body, ...document.querySelectorAll("#cabinet, #screen, #library, #player, #game-grid, #instruction-strip")]) {
      if (el.scrollWidth > el.clientWidth + 1) found.push({ element: el.id || el.tagName.toLowerCase(), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    }
    return found;
  });
}

// Tab through the document, recording focus visibility (2.4.7), indicator size (2.4.13) and obscuring (2.4.11).
async function tabStops(page, { limit = 60 } = {}) {
  const stops = [];
  const walk = `walk-${Date.now()}-${Math.random()}`;
  const inspect = () => page.evaluate(([describeSource, token]) => {
    const describe = new Function(`return (${describeSource})`)();
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const seenBefore = el.__tabStop === token;
    el.__tabStop = token;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    // Chromium snaps layout boxes and scroll offsets to whole pixels, so an element it has just
    // scrolled into view can end 1-2 px past the viewport edge. Only real overlap matters here.
    const slack = 2;
    return {
      target: describe(el),
      tag: el.tagName,
      seenBefore,
      focusVisible: el.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      inViewport: rect.top >= -slack && rect.left >= -slack && rect.bottom <= window.innerHeight + slack && rect.right <= window.innerWidth + slack,
      unobscured: hit !== null && (hit === el || el.contains(hit))
    };
  }, [describeElement.toString(), walk]);
  for (let step = 0; step < limit; step++) {
    await page.keyboard.press("Tab");
    let stop = await inspect();
    // Focus inside the embedded game belongs to the game; keep tabbing until it comes back out.
    for (let hop = 0; stop?.tag === "IFRAME" && stop.seenBefore && hop < 6; hop++) {
      await page.keyboard.press("Tab");
      stop = await inspect();
    }
    if (!stop || stop.seenBefore) break;
    stops.push(stop);
  }
  return stops;
}

async function motionStyles(page) {
  return page.evaluate(() => {
    const found = [];
    for (const el of document.querySelectorAll("body, body *")) {
      for (const pseudo of [null, "::before", "::after"]) {
        const style = getComputedStyle(el, pseudo);
        const transitions = style.transitionProperty !== "none" && style.transitionDuration.split(",").some((value) => Number.parseFloat(value) > 0);
        const animates = style.animationName !== "none";
        if (transitions || animates) found.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${pseudo ?? ""}`);
      }
    }
    return { moving: found, scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior };
  });
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

  test("the gate reports injected serious and moderate violations", async ({ page }) => {
    await stubRemoteGames(page);
    await openLibrary(page);
    await page.locator(".library-heading").evaluate((heading) => {
      const image = document.createElement("img");
      image.src = "./assets/coin.svg";
      const button = document.createElement("button");
      button.type = "button";
      heading.append(image, button);
      for (const label of ["Duplicate", "Duplicate"]) {
        const nav = document.createElement("nav");
        nav.setAttribute("aria-label", label);
        const link = document.createElement("a");
        link.href = "#library";
        link.textContent = label;
        nav.append(link);
        heading.append(nav);
      }
    });
    const found = await axeViolations(page);
    expect(found.map((violation) => violation.id)).toEqual(expect.arrayContaining(["image-alt", "button-name", "landmark-unique"]));
    expect(found.map((violation) => violation.impact)).toEqual(expect.arrayContaining(["critical", "moderate"]));
  });

  test("landmarks carry distinct names while a game is playing", async ({ page }) => {
    await stubRemoteGames(page);
    await openLibrary(page);
    const title = await page.locator('#game-grid .game-card[data-game-id="mona-maze"] .game-name').textContent();
    await launchGame(page, "mona-maze");
    const landmarks = await page.evaluate(() => Array.from(document.querySelectorAll("header, main, section, footer"))
      .filter((el) => !el.hidden && el.closest("[hidden]") === null)
      .map((el) => `${el.tagName.toLowerCase()}#${el.id || el.className}: ${el.getAttribute("aria-label")
        ?? document.getElementById(el.getAttribute("aria-labelledby") ?? "")?.textContent ?? ""}`));
    expect(landmarks).toEqual(expect.arrayContaining([
      "header#page-header: Site header",
      "main#cabinet: Arcade cabinet",
      "section#screen: Arcade screen",
      "section#player: Now playing",
      `section#instruction-strip: ${title}`
    ]));
    await expect(page.locator("#player-title")).toHaveText(title);
  });
});

test.describe("WCAG 2.2 AA checks", () => {
  test("fits a 320 px viewport without horizontal scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await stubRemoteGames(page);
    await openLibrary(page);
    expect(await horizontalOverflow(page), "library").toEqual([]);
    expect(await undersizedTargets(page), "library targets").toEqual([]);

    await launchGame(page, "mona-crossing");
    await page.locator("#guide-toggle").click();
    await expect(page.locator("#player-guide")).toBeVisible();
    expect(await horizontalOverflow(page), "playing").toEqual([]);
    expect(await undersizedTargets(page), "playing targets").toEqual([]);

    await page.locator("#focus-button").click();
    await expect(page.locator("#cabinet")).toHaveClass(/is-focused/);
    expect(await horizontalOverflow(page), "focus mode").toEqual([]);
    expect(await undersizedTargets(page), "focus mode targets").toEqual([]);
    await expectAccessible(page, "focus mode at 320 px");
  });

  test("pointer targets measure at least 24 by 24 CSS px on desktop", async ({ page }) => {
    await stubRemoteGames(page);
    await openLibrary(page);
    expect(await undersizedTargets(page), "library").toEqual([]);
    await launchGame(page, "mona-maze");
    await page.locator("#guide-toggle").click();
    await expect(page.locator("#player-guide")).toBeVisible();
    expect(await undersizedTargets(page), "playing").toEqual([]);
  });

  test("every keyboard stop shows an unobscured 3 px focus ring", async ({ page }) => {
    await stubRemoteGames(page);
    await openLibrary(page);
    const library = await tabStops(page);
    expect(library.map((stop) => stop.target)).toEqual(expect.arrayContaining([
      "a.skip-link", "a.wordmark", "button#theme-toggle.theme-button", "button.game-card.lavender", "button.game-card.mint",
      "button.game-card.coral", "button#deck-library.arcade-control.lavender", "button#effects-button.arcade-control.coral"
    ]));
    expect(library.filter((stop) => stop.target.startsWith("button.game-card")).length).toBe(await page.locator("#game-grid .game-card").count());
    for (const stop of library) {
      expect(stop, stop.target).toMatchObject({ focusVisible: true, outlineStyle: "solid", inViewport: true, unobscured: true });
      expect(stop.outlineWidth, stop.target).toBeGreaterThanOrEqual(3);
    }

    await page.locator('#game-grid .game-card[data-game-id="mona-maze"]').focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#frame-host iframe")).toHaveCount(1);
    await expect(page.locator("#frame-host iframe")).toBeFocused();
    await page.locator("#guide-toggle").click();
    await expect(page.locator("#player-guide")).toBeVisible();
    await page.locator("#return-button").focus();
    const playing = await tabStops(page);
    expect(playing.map((stop) => stop.target)).toEqual(expect.arrayContaining([
      "button#focus-button.small-button", "button#fullscreen-button.small-button", "a#open-game.small-button",
      "button#enter-game.text-button", "button#reload-game.text-button", "button#guide-toggle.text-button", "a.game-repo", "iframe",
      "button#deck-library.arcade-control.lavender", "button#deck-focus.arcade-control.mint"
    ]));
    for (const stop of playing) {
      if (stop.tag === "IFRAME") continue;
      expect(stop, stop.target).toMatchObject({ focusVisible: true, outlineStyle: "solid", inViewport: true, unobscured: true });
      expect(stop.outlineWidth, stop.target).toBeGreaterThanOrEqual(3);
    }
  });

  test("focus mode keeps its controls reachable and unobscured on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await stubRemoteGames(page);
    await openLibrary(page);
    await launchGame(page, "mona-maze");
    await page.locator("#guide-toggle").click();
    await page.locator("#focus-button").click();
    await expect(page.locator("#cabinet")).toHaveClass(/is-focused/);
    await expect(page.locator("#focus-button")).toBeFocused();
    await expect(page.locator("#focus-button")).toHaveText("Exit focus");
    await page.locator("#return-button").focus();
    const stops = await tabStops(page);
    expect(stops.map((stop) => stop.target)).toEqual(expect.arrayContaining(["button#focus-button.small-button", "a.game-repo", "iframe"]));
    for (const stop of stops) {
      if (stop.tag === "IFRAME") continue;
      expect(stop, stop.target).toMatchObject({ focusVisible: true, inViewport: true, unobscured: true });
    }
    await page.keyboard.press("Escape");
    await expect(page.locator("#cabinet")).not.toHaveClass(/is-focused/);
    await expect(page.locator("#focus-button")).toHaveText("Focus mode");
  });

  test("honours prefers-reduced-motion", async ({ page }) => {
    await stubRemoteGames(page);
    await openLibrary(page);
    const normal = await motionStyles(page);
    expect(normal.moving, "cards animate when motion is allowed").toEqual(expect.arrayContaining([expect.stringMatching(/^button/)]));

    await page.emulateMedia({ reducedMotion: "reduce" });
    await openLibrary(page);
    await launchGame(page, "mona-maze");
    expect(await motionStyles(page)).toEqual({ moving: [], scrollBehavior: "auto" });
  });

  test("announces catalog, frame and mode changes through live regions", async ({ page }) => {
    await stubRemoteGames(page);
    await openLibrary(page);
    await expect(page.locator('#catalog-loading[role="status"]')).toHaveCount(1);
    await expect(page.locator('#catalog-notice[role="status"]')).toHaveCount(1);
    await expect(page.locator('#catalog-error[role="alert"]')).toHaveCount(1);
    await expect(page.locator('#frame-status[role="status"][aria-live="polite"]')).toHaveCount(1);
    await expect(page.locator('#mode-status[role="status"]')).toHaveCount(1);

    const title = await page.locator('#game-grid .game-card[data-game-id="mona-maze"] .game-name').textContent();
    await launchGame(page, "mona-maze");
    await expect(page.locator("#frame-status")).toContainText(new RegExp(`Opening ${title}|Blank screen or trouble playing`));
    await expect(page.locator("#frame-host iframe")).toHaveAttribute("title", `${title} — interactive game`);

    await page.goto("/#game/not-a-game");
    await expect(page.locator("#catalog-notice")).toHaveText("That game is not in this cabinet. Choose one below.");
    await expect(page.locator("#frame-host iframe")).toHaveCount(0);
  });

  test("deep links and browser history keep a single iframe", async ({ page }) => {
    await stubRemoteGames(page);
    await page.goto("/#game/mona-sweeper");
    await expect(page.locator("#catalog-loading")).toBeHidden();
    await expect(page.locator("#frame-host iframe")).toHaveCount(1);
    await expect(page.locator("#frame-host iframe")).toHaveAttribute("src", "https://jdooley-clt.github.io/mona-sweeper/");
    await expect(page).toHaveTitle("Mona Sweeper · GitHub Arcade");

    await page.locator("#return-button").click();
    await expect(page.locator("#frame-host iframe")).toHaveCount(0);
    await expect(page).toHaveTitle("GitHub Arcade — The Commit Cabinet");
    await page.locator('#game-grid .game-card[data-game-id="mona-breaker"]').click();
    await expect(page.locator("#frame-host iframe")).toHaveAttribute("src", "https://jdooley-clt.github.io/mona-breaker/");

    await page.goBack();
    await expect(page.locator("#frame-host iframe")).toHaveCount(0);
    await expect(page.locator("#library")).toBeVisible();
    await page.goBack();
    await expect(page.locator("#frame-host iframe")).toHaveCount(1);
    await expect(page.locator("#frame-host iframe")).toHaveAttribute("src", "https://jdooley-clt.github.io/mona-sweeper/");
    await page.goForward();
    await page.goForward();
    await expect(page.locator("#frame-host iframe")).toHaveCount(1);
    await expect(page.locator("#frame-host iframe")).toHaveAttribute("src", "https://jdooley-clt.github.io/mona-breaker/");
  });
});

// The search field appears once the catalog lists six games; Mona Patrol is the sixth.
test.describe("six-game library", () => {
  const patrol = catalog.find((game) => game.id === "mona-patrol");
  test.skip(catalog.length < 6 || !patrol, "needs a catalog of six games that includes mona-patrol");

  const cards = (page) => page.locator("#game-grid .game-card");

  // Both artwork layers must exist, resolve to the catalog assets, and decode (gameArt hides an image that fails to load).
  async function expectArtwork(scope, game, state) {
    const layers = [["cover", scope.locator("img.game-art"), game.coverArt], ["character", scope.locator("img.cover-character"), game.coverCharacter]];
    for (const [layer, image, source] of layers) {
      const asset = source.replace(/^\.\//, "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      await expect(image, `${state} ${layer}`).toHaveAttribute("src", new RegExp(`${asset}$`));
      await expect(image, `${state} ${layer}`).toBeVisible();
      await expect.poll(() => image.evaluate((img) => !img.hidden && img.complete && img.naturalWidth > 0), { message: `${state} ${layer} decodes` }).toBe(true);
    }
  }

  test("shows the search field and counts every game", async ({ page }) => {
    await stubRemoteGames(page);
    await openLibrary(page);
    await expect(page.locator("#search-wrap")).toBeVisible();
    await expect(page.locator("#game-search")).toHaveAttribute("type", "search");
    await expect(page.locator("#game-count")).toHaveText(`${catalog.length} GAMES / ALWAYS FREE`);
    await expect(cards(page)).toHaveCount(catalog.length);
    await expect(cards(page).last()).toHaveAttribute("data-game-id", catalog.at(-1).id);
    await expect(page.locator("#library")).toHaveClass(/has-many/);
    await expect(page.locator("#library-footnote")).toHaveText("Scroll for more games");
    await expectAccessible(page, "six-game library");
  });

  test("filters cards by search text and restores them when cleared", async ({ page }) => {
    await stubRemoteGames(page);
    await openLibrary(page);
    const search = page.locator("#game-search");
    await search.fill("Patrol");
    await expect(cards(page)).toHaveCount(1);
    await expect(cards(page)).toHaveAttribute("data-game-id", "mona-patrol");
    await expect(cards(page).locator(".game-name")).toHaveText(patrol.title);
    await expect(page.locator("#empty-results")).toBeHidden();
    await expect(page.locator("#game-count"), "the count stays the catalog total").toHaveText(`${catalog.length} GAMES / ALWAYS FREE`);
    await expectAccessible(page, "filtered library");

    await search.fill("no such game");
    await expect(cards(page)).toHaveCount(0);
    await expect(page.locator("#empty-results")).toHaveText("No games match. Try another search.");
    await expectAccessible(page, "library without matches");

    await search.fill("");
    await expect(cards(page)).toHaveCount(catalog.length);
    await expect(page.locator("#empty-results")).toBeHidden();
    await expect(page.locator('#game-grid .game-card[data-game-id="mona-patrol"]')).toHaveCount(1);
  });

  test("renders both Mona Patrol cover layers in the card and the playing header", async ({ page }) => {
    await stubRemoteGames(page);
    await openLibrary(page);
    const card = page.locator('#game-grid .game-card[data-game-id="mona-patrol"]');
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator(".game-name")).toHaveText(patrol.title);
    await expect(card.locator(".game-category")).toHaveText(patrol.category);
    await expect(card).toHaveClass(new RegExp(`\\b${patrol.accent}\\b`));
    await expectArtwork(card, patrol, "card");

    await launchGame(page, "mona-patrol");
    await expect(page.locator("#player-title")).toHaveText(patrol.title);
    await expect(page).toHaveTitle(`${patrol.title} · GitHub Arcade`);
    await expectArtwork(page.locator("#cover-image"), patrol, "playing header");
    await expect(page.locator("#instruction-content .game-repo")).toHaveAttribute("href", patrol.repository);
    await expectAccessible(page, "playing Mona Patrol");
  });

  test("Space after launch stays in the game and Return restores the Mona Patrol card", async ({ page }) => {
    await stubRemoteGames(page);
    await openLibrary(page);
    const card = page.locator('#game-grid .game-card[data-game-id="mona-patrol"]');
    await card.focus();
    await page.keyboard.press("Enter");
    const iframe = page.locator("#frame-host iframe");
    await expect(iframe).toHaveCount(1);
    await expect(iframe).toBeFocused();
    await expect(page.frameLocator("#frame-host iframe").getByRole("heading", { name: "Stub game" })).toBeVisible();

    // Space belongs to the game: it must not reach Game library (or any toolbar button) and eject the player.
    await page.keyboard.press("Space");
    await expect(iframe).toHaveCount(1);
    await expect(iframe).toBeFocused();
    await expect(page.locator("#player")).toBeVisible();
    await expect(page.locator("#library")).toBeHidden();

    await page.locator("#return-button").click();
    await expect(iframe).toHaveCount(0);
    await expect(page.locator("#library")).toBeVisible();
    await expect(card).toBeFocused();
  });

  test("the search field is a focusable, unobscured keyboard stop", async ({ page }) => {
    await stubRemoteGames(page);
    await openLibrary(page);
    const stops = await tabStops(page);
    const search = stops.find((stop) => stop.target === "input#game-search");
    expect(search, stops.map((stop) => stop.target).join(", ")).toBeDefined();
    expect(search).toMatchObject({ focusVisible: true, outlineStyle: "solid", inViewport: true, unobscured: true });
    expect(search.outlineWidth).toBeGreaterThanOrEqual(3);
    expect(stops.indexOf(search), "the search field comes before the cards").toBeLessThan(stops.findIndex((stop) => stop.target.startsWith("button.game-card")));
  });

  for (const width of [320, 390]) {
    test(`fits a ${width} px viewport with the search field visible`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await stubRemoteGames(page);
      await openLibrary(page);
      await expect(page.locator("#search-wrap")).toBeVisible();
      expect(await horizontalOverflow(page), "library").toEqual([]);
      expect(await undersizedTargets(page), "library targets").toEqual([]);

      await page.locator("#game-search").fill("Patrol");
      await expect(cards(page)).toHaveCount(1);
      expect(await horizontalOverflow(page), "filtered library").toEqual([]);
      await expectAccessible(page, `filtered library at ${width} px`);

      await launchGame(page, "mona-patrol");
      await page.locator("#guide-toggle").click();
      await expect(page.locator("#player-guide")).toBeVisible();
      expect(await horizontalOverflow(page), "playing").toEqual([]);
      expect(await undersizedTargets(page), "playing targets").toEqual([]);
      await expectAccessible(page, `playing Mona Patrol at ${width} px`);

      await page.locator("#return-button").click();
      await expect(page.locator("#library")).toBeVisible();
      await expect(page.locator("#game-search"), "the search text survives a round trip").toHaveValue("Patrol");
      await expect(cards(page)).toHaveCount(1);
    });
  }
});
