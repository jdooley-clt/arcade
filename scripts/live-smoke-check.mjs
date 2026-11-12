// Checks the published cabinet and game sites without a browser: every page
// answers 200 with its expected <title>, and the live catalog still validates
// and points at jdooley-clt URLs. Results land in live-smoke/results.json for
// scripts/report-live-smoke.mjs; the exit code is 1 when any check fails.
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { validateCatalog } from "../src/catalog.js";

export const CABINET_URL = "https://jdooley-clt.github.io/arcade/";
export const ACCOUNT_ORIGIN = "https://jdooley-clt.github.io/";
export const ACCOUNT_REPOSITORIES = "https://github.com/jdooley-clt/";

// Titles are the live pages' own; a changed title is worth a look, not silence.
export const SITES = [
  { url: CABINET_URL, title: "GitHub Arcade — The Commit Cabinet" },
  { url: "https://jdooley-clt.github.io/mona-maze/", title: "Mona's Merge Maze" },
  { url: "https://jdooley-clt.github.io/flappy-copilot/", title: "FLAPPY COPILOT — a retro terminal game" },
  { url: "https://jdooley-clt.github.io/mona-breaker/", title: "Mona Breaker" },
  { url: "https://jdooley-clt.github.io/mona-crossing/", title: "Mona Crossing" },
  { url: "https://jdooley-clt.github.io/mona-sweeper/", title: "Mona Sweeper" }
];

const DECODE = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", "#39": "'", "#x27": "'" };

export function pageTitle(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return null;
  return match[1]
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
      if (code in DECODE) return DECODE[code];
      if (/^#x/i.test(code)) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
      return entity;
    })
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url, fetchImpl, timeoutMs) {
  const response = await fetchImpl(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  return { status: response.status, text: await response.text() };
}

export async function checkSite(site, { fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  const check = { name: `page ${site.url}`, url: site.url, ok: false, detail: "" };
  try {
    const { status, text } = await fetchText(site.url, fetchImpl, timeoutMs);
    const title = pageTitle(text);
    if (status !== 200) check.detail = `HTTP ${status}`;
    else if (site.title !== undefined && title !== site.title) check.detail = `title was ${JSON.stringify(title)}, expected ${JSON.stringify(site.title)}`;
    else { check.ok = true; check.detail = `HTTP 200, title ${JSON.stringify(title)}`; }
  } catch (error) {
    check.detail = `request failed: ${error.message}`;
  }
  return check;
}

export async function checkCatalog({ fetchImpl = fetch, timeoutMs = 20_000, cabinetUrl = CABINET_URL } = {}) {
  const url = new URL("games.json", cabinetUrl).href;
  const check = { name: `catalog ${url}`, url, ok: false, detail: "", games: [] };
  try {
    const { status, text } = await fetchText(url, fetchImpl, timeoutMs);
    if (status !== 200) { check.detail = `HTTP ${status}`; return check; }
    const { games, errors } = validateCatalog(JSON.parse(text), cabinetUrl);
    const problems = [...errors];
    if (games.length === 0) problems.push("the catalog lists no games");
    for (const game of games) {
      if (!game.url.startsWith(ACCOUNT_ORIGIN)) problems.push(`${game.id}: url ${game.url} is not under ${ACCOUNT_ORIGIN}`);
      if (!game.repository.startsWith(ACCOUNT_REPOSITORIES)) problems.push(`${game.id}: repository ${game.repository} is not under ${ACCOUNT_REPOSITORIES}`);
    }
    check.games = games.map(({ id, title, url: gameUrl }) => ({ id, title, url: gameUrl }));
    if (problems.length) check.detail = problems.join("; ");
    else { check.ok = true; check.detail = `${games.length} games validate under jdooley-clt`; }
  } catch (error) {
    check.detail = `request failed: ${error.message}`;
  }
  return check;
}

export async function runChecks(options = {}) {
  const catalog = await checkCatalog(options);
  const sites = await Promise.all(SITES.map((site) => checkSite(site, options)));
  // Games added to the live catalog are covered even before this list learns their titles.
  const known = new Set(SITES.map((site) => site.url));
  const extras = await Promise.all(catalog.games.filter((game) => !known.has(game.url)).map((game) => checkSite({ url: game.url }, options)));
  const checks = [...sites, catalog, ...extras];
  return { startedAt: new Date().toISOString(), ok: checks.every((check) => check.ok), checks };
}

export async function main({ outputDir = "live-smoke", log = console.log } = {}) {
  const results = await runChecks();
  await mkdir(outputDir, { recursive: true });
  await writeFile(`${outputDir}/results.json`, `${JSON.stringify(results, null, 2)}\n`);
  for (const check of results.checks) log(`${check.ok ? "ok  " : "FAIL"} ${check.name}: ${check.detail}`);
  log(results.ok ? "All live checks passed." : "Live checks failed.");
  return results.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
