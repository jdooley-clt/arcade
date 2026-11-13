import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ISSUE_TITLE, buildIssueBody, collectFailures, reportLiveSmoke } from "../scripts/report-live-smoke.mjs";
import { SITES, checkCatalog, checkSite, pageTitle } from "../scripts/live-smoke-check.mjs";

const RUN_URL = "https://github.com/jdooley-clt/arcade/actions/runs/123";
const BAD_URL = "https://jdooley-clt.github.io/mona-breaker/";

function fakeGh({ openIssue = null } = {}) {
  const calls = [];
  const gh = async (args, { input } = {}) => {
    calls.push({ args, input });
    if (args[0] === "issue" && args[1] === "list") return JSON.stringify(openIssue ? [openIssue, { number: 999, title: "Unrelated live smoke chatter" }] : []);
    if (args[0] === "issue" && args[1] === "create") return "https://github.com/jdooley-clt/arcade/issues/42\n";
    return "";
  };
  gh.calls = calls;
  gh.find = (verb) => calls.filter((call) => call.args[0] === "issue" && call.args[1] === verb);
  return gh;
}

const failingResults = {
  ok: false,
  checks: [
    { name: "page https://jdooley-clt.github.io/arcade/", url: "https://jdooley-clt.github.io/arcade/", ok: true, detail: "HTTP 200" },
    { name: `page ${BAD_URL}`, url: BAD_URL, ok: false, detail: "HTTP 404" }
  ]
};

const failingPlaywright = {
  stats: { expected: 1, unexpected: 1 },
  suites: [{
    title: "live-smoke.spec.js",
    specs: [
      { title: "the live cabinet serves its library", tests: [{ status: "expected", results: [{ status: "passed" }] }] },
      {
        title: "every catalog game launches from the live cabinet and returns to the library",
        tests: [{ status: "unexpected", results: [{ status: "failed", error: { message: "\u001b[31mError: expect(received).toEqual(expected)\u001b[39m\n\nmona-breaker: Timed out waiting for canvas" } }] }]
      }
    ]
  }]
};

test("a failing URL and a failing browser test are collected from the run artifacts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "live-smoke-"));
  try {
    await writeFile(join(dir, "results.json"), JSON.stringify(failingResults));
    await writeFile(join(dir, "playwright.json"), JSON.stringify(failingPlaywright));
    const failures = await collectFailures({ resultsPath: join(dir, "results.json"), playwrightPath: join(dir, "playwright.json"), outcomes: { http: "failure", browser: "failure" } });
    assert.deepEqual(failures.map((failure) => failure.url), [BAD_URL, undefined]);
    assert.equal(failures[0].detail, "HTTP 404");
    assert.match(failures[1].detail, /^Browser smoke "every catalog game launches/);
    assert.doesNotMatch(failures[1].detail, /\u001b/, "ANSI colour codes are stripped");

    await writeFile(join(dir, "results.json"), JSON.stringify({ ok: true, checks: failingResults.checks.map((check) => ({ ...check, ok: true })) }));
    await writeFile(join(dir, "playwright.json"), JSON.stringify({ stats: { unexpected: 0 }, suites: [{ title: "live-smoke.spec.js", specs: [{ title: "ok", tests: [{ status: "expected", results: [{ status: "passed" }] }] }] }] }));
    assert.deepEqual(await collectFailures({ resultsPath: join(dir, "results.json"), playwrightPath: join(dir, "playwright.json"), outcomes: { http: "success", browser: "success" } }), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("missing artifacts after failed steps are reported instead of being treated as green", async () => {
  const dir = await mkdtemp(join(tmpdir(), "live-smoke-"));
  try {
    const failures = await collectFailures({ resultsPath: join(dir, "results.json"), playwrightPath: join(dir, "playwright.json"), outcomes: { http: "failure", browser: "cancelled" } });
    assert.equal(failures.length, 2);
    assert.match(failures[0].detail, /HTTP checks produced no results \(step outcome: failure\)/);
    assert.match(failures[1].detail, /browser smoke produced no report \(step outcome: cancelled\)/);
    assert.deepEqual(await collectFailures({ resultsPath: join(dir, "results.json"), playwrightPath: join(dir, "playwright.json"), outcomes: { http: "success", browser: "skipped" } }), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a bad URL opens the tracking issue when none is open", async () => {
  const gh = fakeGh();
  const failures = [{ url: BAD_URL, detail: "HTTP 404" }];
  const outcome = await reportLiveSmoke({ failures, runUrl: RUN_URL, repository: "jdooley-clt/arcade", gh, log: () => {} });
  assert.deepEqual(outcome, { action: "created", url: "https://github.com/jdooley-clt/arcade/issues/42" });
  const [create] = gh.find("create");
  assert.ok(create, "gh issue create ran");
  assert.deepEqual(create.args.slice(0, 8), ["issue", "create", "--repo", "jdooley-clt/arcade", "--title", ISSUE_TITLE, "--body-file", "-"]);
  assert.ok(create.input.includes(`- ${BAD_URL} — HTTP 404`), "the body lists the failing URL");
  assert.ok(create.input.includes(`Run: ${RUN_URL}`), "the body links the run");
  assert.equal(gh.find("edit").length, 0);
  assert.equal(gh.find("close").length, 0);
});

test("a bad URL updates the open tracking issue instead of opening a second one", async () => {
  const gh = fakeGh({ openIssue: { number: 7, title: ISSUE_TITLE } });
  const failures = [{ url: BAD_URL, detail: "HTTP 404" }, { detail: "Browser smoke \"every catalog game launches\": mona-breaker timed out" }];
  const outcome = await reportLiveSmoke({ failures, runUrl: RUN_URL, repository: "jdooley-clt/arcade", gh, log: () => {} });
  assert.deepEqual(outcome, { action: "updated", number: 7 });
  assert.equal(gh.find("create").length, 0);
  const [edit] = gh.find("edit");
  assert.deepEqual(edit.args, ["issue", "edit", "7", "--repo", "jdooley-clt/arcade", "--body-file", "-"]);
  assert.match(edit.input, /- https:\/\/jdooley-clt\.github\.io\/mona-breaker\/ — HTTP 404/);
  assert.match(edit.input, /- Browser smoke "every catalog game launches": mona-breaker timed out/);
  assert.equal(gh.find("close").length, 0);
});

test("a green run comments on and closes the open tracking issue", async () => {
  const gh = fakeGh({ openIssue: { number: 7, title: ISSUE_TITLE } });
  const outcome = await reportLiveSmoke({ failures: [], runUrl: RUN_URL, repository: "jdooley-clt/arcade", gh, log: () => {} });
  assert.deepEqual(outcome, { action: "closed", number: 7 });
  const verbs = gh.calls.map((call) => call.args[1]);
  assert.deepEqual(verbs, ["list", "comment", "close"]);
  const [comment] = gh.find("comment");
  assert.equal(comment.args[2], "7");
  assert.equal(comment.input, `All live checks passed in ${RUN_URL}. Closing automatically.\n`);
  assert.deepEqual(gh.find("close")[0].args, ["issue", "close", "7", "--repo", "jdooley-clt/arcade", "--reason", "completed"]);
});

test("a green run with no open issue changes nothing", async () => {
  const gh = fakeGh();
  assert.deepEqual(await reportLiveSmoke({ failures: [], runUrl: RUN_URL, repository: "jdooley-clt/arcade", gh, log: () => {} }), { action: "none" });
  assert.deepEqual(gh.calls.map((call) => call.args[1]), ["list"]);
});

test("the issue body lists every failure with the run link and timestamp", () => {
  const body = buildIssueBody({ failures: [{ url: BAD_URL, detail: "HTTP 404" }, { detail: "The HTTP checks produced no results (step outcome: failure)." }], runUrl: RUN_URL, checkedAt: "2026-01-02T03:04:05.000Z" });
  assert.match(body, /^<!-- live-smoke-report -->\n/);
  assert.match(body, /## Failing checks\n\n- https:\/\/jdooley-clt\.github\.io\/mona-breaker\/ — HTTP 404\n- The HTTP checks produced no results/);
  assert.match(body, /Last checked: 2026-01-02T03:04:05\.000Z\n$/);
});

test("page checks compare status and decoded title; the catalog check enforces jdooley-clt URLs", async () => {
  assert.equal(pageTitle("<html><head><title>\n  Mona&#39;s Merge Maze </title>"), "Mona's Merge Maze");
  assert.equal(pageTitle("<title>GitHub Arcade &mdash; x</title>"), "GitHub Arcade &mdash; x", "unknown entities are left alone");
  assert.equal(SITES[0].url, "https://jdooley-clt.github.io/arcade/");
  assert.ok(SITES.every((site) => site.url.startsWith("https://jdooley-clt.github.io/") && site.url.endsWith("/")));
  const catalog = JSON.parse(await readFile(new URL("../games.json", import.meta.url), "utf8"));
  for (const game of catalog) {
    assert.ok(SITES.some((site) => site.url === game.url), `${game.id} needs a title check in SITES`);
  }

  const respond = (status, body) => async () => new Response(body, { status, headers: { "content-type": "text/html" } });
  const ok = await checkSite({ url: BAD_URL, title: "Mona Breaker" }, { fetchImpl: respond(200, "<title>Mona Breaker</title>") });
  assert.equal(ok.ok, true);
  const notFound = await checkSite({ url: BAD_URL, title: "Mona Breaker" }, { fetchImpl: respond(404, "<title>Site not found · GitHub Pages</title>") });
  assert.deepEqual([notFound.ok, notFound.detail], [false, "HTTP 404"]);
  const renamed = await checkSite({ url: BAD_URL, title: "Mona Breaker" }, { fetchImpl: respond(200, "<title>Something else</title>") });
  assert.deepEqual([renamed.ok, renamed.detail], [false, "title was \"Something else\", expected \"Mona Breaker\""]);
  const down = await checkSite({ url: BAD_URL, title: "Mona Breaker" }, { fetchImpl: async () => { throw new Error("ECONNRESET"); } });
  assert.deepEqual([down.ok, down.detail], [false, "request failed: ECONNRESET"]);

  const game = (overrides = {}) => ({
    id: "mona-breaker", title: "Mona Breaker", description: "d", instructions: "i", controls: [{ keys: "k", action: "a" }],
    url: "https://jdooley-clt.github.io/mona-breaker/", repository: "https://github.com/jdooley-clt/mona-breaker", art: "./assets/mona-breaker.webp", ...overrides
  });
  const catalogOk = await checkCatalog({ fetchImpl: respond(200, JSON.stringify([game()])) });
  assert.equal(catalogOk.ok, true, catalogOk.detail);
  assert.deepEqual(catalogOk.games, [{ id: "mona-breaker", title: "Mona Breaker", url: "https://jdooley-clt.github.io/mona-breaker/" }]);
  const stale = await checkCatalog({ fetchImpl: respond(200, JSON.stringify([game({ url: "https://filmgirl.github.io/mona-breaker/", repository: "https://github.com/filmgirl/mona-breaker" })])) });
  assert.equal(stale.ok, false);
  assert.match(stale.detail, /url https:\/\/filmgirl\.github\.io\/mona-breaker\/ is not under https:\/\/jdooley-clt\.github\.io\//);
  assert.match(stale.detail, /repository https:\/\/github\.com\/filmgirl\/mona-breaker is not under https:\/\/github\.com\/jdooley-clt\//);
  const invalid = await checkCatalog({ fetchImpl: respond(200, JSON.stringify([game({ url: "javascript:alert(1)" })])) });
  assert.deepEqual([invalid.ok, invalid.detail], [false, "Game 1: url must use HTTPS.; the catalog lists no games"]);
  const empty = await checkCatalog({ fetchImpl: respond(200, "[]") });
  assert.deepEqual([empty.ok, empty.detail], [false, "the catalog lists no games"]);
});
