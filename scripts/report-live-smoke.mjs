// Turns a live-smoke run into exactly one tracking issue: failing runs open or
// refresh it with the failing URLs and the run link, and the first green run
// afterwards comments and closes it. Runs through the gh CLI (GH_TOKEN), and
// takes an injectable runner so the behaviour is unit-tested without GitHub.
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const ISSUE_TITLE = "[Live Smoke] GitHub Arcade Pages health check failing";
const MARKER = "<!-- live-smoke-report -->";

const stripAnsi = (text) => String(text ?? "").replace(/\u001b\[[0-9;]*m/g, "");
const firstLine = (text) => stripAnsi(text).split("\n").map((line) => line.trim()).find(Boolean) ?? "unknown error";

async function readJson(path, readFileImpl) {
  try {
    return JSON.parse(await readFileImpl(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function* unexpectedTests(suites, trail = []) {
  for (const suite of suites ?? []) {
    const path = suite.title ? [...trail, suite.title] : trail;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (test.status === "expected" || test.status === "skipped" || test.status === "flaky") continue;
        const result = [...(test.results ?? [])].reverse().find((candidate) => candidate.status !== "passed") ?? test.results?.at(-1);
        const message = result?.error?.message ?? result?.errors?.[0]?.message ?? `${result?.status ?? test.status}`;
        yield { title: [...path.filter((part) => !part.endsWith(".spec.js")), spec.title].join(" › "), message: firstLine(message) };
      }
    }
    yield* unexpectedTests(suite.suites, path);
  }
}

export async function collectFailures({
  resultsPath = "live-smoke/results.json",
  playwrightPath = "live-smoke/playwright.json",
  outcomes = {},
  readFileImpl = readFile
} = {}) {
  const failures = [];
  const results = await readJson(resultsPath, readFileImpl);
  if (results) {
    for (const check of results.checks ?? []) {
      if (!check.ok) failures.push({ url: check.url, detail: check.detail || check.name });
    }
  } else if (outcomes.http && outcomes.http !== "success") {
    failures.push({ detail: `The HTTP checks produced no results (step outcome: ${outcomes.http}).` });
  }

  const report = await readJson(playwrightPath, readFileImpl);
  if (report) {
    for (const test of unexpectedTests(report.suites)) failures.push({ detail: `Browser smoke "${test.title}": ${test.message}` });
    if (!failures.some((failure) => failure.detail.startsWith("Browser smoke")) && outcomes.browser && outcomes.browser !== "success" && outcomes.browser !== "skipped") {
      failures.push({ detail: `The browser smoke step ended with outcome ${outcomes.browser} without reporting a failing test.` });
    }
  } else if (outcomes.browser && outcomes.browser !== "success" && outcomes.browser !== "skipped") {
    failures.push({ detail: `The browser smoke produced no report (step outcome: ${outcomes.browser}).` });
  }
  return failures;
}

export function buildIssueBody({ failures, runUrl, checkedAt = new Date() }) {
  const lines = [
    MARKER,
    "The daily live smoke of the published GitHub Arcade found problems. This issue is",
    "kept current by `.github/workflows/live-smoke.yml` and closes itself after the",
    "next green run.",
    "",
    "## Failing checks",
    "",
    ...failures.map((failure) => (failure.url ? `- ${failure.url} — ${failure.detail}` : `- ${failure.detail}`)),
    "",
    `Run: ${runUrl}`,
    `Last checked: ${new Date(checkedAt).toISOString()}`,
    ""
  ];
  return lines.join("\n");
}

export function ghRunner(args, { input } = {}) {
  return execFileSync("gh", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "inherit"] });
}

async function findOpenIssue({ repository, gh, title }) {
  const output = await gh(["issue", "list", "--repo", repository, "--state", "open", "--search", `"${title}" in:title`, "--json", "number,title", "--limit", "20"]);
  const issues = output.trim() ? JSON.parse(output) : [];
  return issues.find((issue) => issue.title === title) ?? null;
}

export async function reportLiveSmoke({ failures, runUrl, repository, gh = ghRunner, title = ISSUE_TITLE, checkedAt = new Date(), log = console.log }) {
  const open = await findOpenIssue({ repository, gh, title });
  if (failures.length > 0) {
    const body = buildIssueBody({ failures, runUrl, checkedAt });
    if (open) {
      await gh(["issue", "edit", String(open.number), "--repo", repository, "--body-file", "-"], { input: body });
      log(`Updated tracking issue #${open.number} with ${failures.length} failing check(s).`);
      return { action: "updated", number: open.number };
    }
    const url = (await gh(["issue", "create", "--repo", repository, "--title", title, "--body-file", "-"], { input: body })).trim();
    log(`Opened tracking issue ${url} with ${failures.length} failing check(s).`);
    return { action: "created", url };
  }
  if (open) {
    const comment = `All live checks passed in ${runUrl}. Closing automatically.\n`;
    await gh(["issue", "comment", String(open.number), "--repo", repository, "--body-file", "-"], { input: comment });
    await gh(["issue", "close", String(open.number), "--repo", repository, "--reason", "completed"]);
    log(`Closed tracking issue #${open.number} after a green run.`);
    return { action: "closed", number: open.number };
  }
  log("All live checks passed and no tracking issue is open.");
  return { action: "none" };
}

export async function main(env = process.env) {
  const repository = env.GITHUB_REPOSITORY;
  if (!repository) throw new Error("GITHUB_REPOSITORY is required.");
  const runUrl = `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${repository}/actions/runs/${env.GITHUB_RUN_ID ?? "unknown"}`;
  const failures = await collectFailures({ outcomes: { http: env.LIVE_SMOKE_HTTP_OUTCOME, browser: env.LIVE_SMOKE_BROWSER_OUTCOME } });
  return reportLiveSmoke({ failures, runUrl, repository });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
