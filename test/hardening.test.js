import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const MAIN_ONLY = "github.repository == 'jdooley-clt/arcade' && github.event_name != 'pull_request' && github.ref == 'refs/heads/main'";

function topLevelBlock(yaml, key) {
  const match = yaml.match(new RegExp(`^${key}:\\n((?:[ \\t]+.*\\n|\\n)*)`, "m"));
  assert.ok(match, `${key}: block exists`);
  return match[1];
}

test("every workflow action is pinned to a full commit SHA with a version comment", async () => {
  const files = (await readdir(new URL(".github/workflows/", root))).filter((name) => /\.ya?ml$/.test(name)).sort();
  assert.deepEqual(files, ["live-smoke.yml", "pages.yml"], "every workflow file is covered by this test");
  for (const file of files) {
    const workflow = await read(`.github/workflows/${file}`);
    const uses = [...workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)(?:\s+#\s*(\S+))?\s*$/gm)];
    assert.ok(uses.length >= 3, `${file} uses actions`);
    for (const [line, action, comment] of uses) {
      assert.match(action, /^[a-z0-9-]+\/[a-z0-9-]+@[0-9a-f]{40}$/, `${file}: ${line.trim()} pins a 40-character commit SHA`);
      assert.match(comment ?? "", /^v\d+(\.\d+)*$/, `${file}: ${line.trim()} carries the version comment Dependabot updates`);
    }
    assert.equal(topLevelBlock(workflow, "permissions").trim(), "contents: read", `${file} grants only contents: read at the top level`);
    assert.match(workflow, /persist-credentials: false/, `${file} does not persist the checkout token`);
  }
});

test("the workflow verifies pull requests and only publishes from main", async () => {
  const workflow = await read(".github/workflows/pages.yml");
  const triggers = topLevelBlock(workflow, "on");
  for (const trigger of ["pull_request:", "push:", "workflow_dispatch:"]) assert.ok(triggers.includes(trigger), `on: lists ${trigger}`);
  assert.equal(topLevelBlock(workflow, "permissions").trim(), "contents: read");
  assert.match(workflow, /persist-credentials: false/);
  for (const step of ["npm ci", "npx playwright install --with-deps chromium", "npm test", "npm run test:browser"]) {
    assert.ok(workflow.includes(`- run: ${step}`), `verify runs ${step}`);
  }
  assert.equal(workflow.split(MAIN_ONLY).length - 1, 2, "the Pages upload step and the deploy job share the main-only guard");
  assert.match(workflow, /needs: verify/);
  assert.doesNotMatch(workflow, /cp [^\n]*(node_modules|package|test|playwright)/, "staging copies only static site files");
  assert.match(workflow, /if: failure\(\)/, "Playwright diagnostics upload on failure");
});

test("the live smoke runs daily with issue access only in its job and always reports", async () => {
  const workflow = await read(".github/workflows/live-smoke.yml");
  const triggers = topLevelBlock(workflow, "on");
  assert.match(triggers, /schedule:\n\s+- cron: "[^"]+"/, "on: schedules a cron run");
  assert.ok(triggers.includes("workflow_dispatch:"), "on: allows manual runs");
  assert.doesNotMatch(triggers, /pull_request|push:/, "the live smoke never runs for code changes");
  assert.match(workflow, /if: github\.repository == 'jdooley-clt\/arcade'/, "forks do not smoke the live site or file issues");
  assert.match(workflow, /permissions:\n\s+contents: read\n\s+issues: write/, "the job can read the checkout and manage the tracking issue");
  assert.doesNotMatch(workflow, /(pull-requests|id-token|pages|actions|packages|deployments): write/, "no other write scopes");
  for (const step of ["npm ci", "npx playwright install --with-deps chromium", "node scripts/live-smoke-check.mjs", "npx playwright test --config playwright.live.config.js", "node scripts/report-live-smoke.mjs"]) {
    assert.ok(workflow.includes(`run: ${step}`), `the smoke runs ${step}`);
  }
  const reportStart = workflow.indexOf("- name: Open, update, or close the tracking issue");
  const reportEnd = workflow.indexOf("run: node scripts/report-live-smoke.mjs");
  assert.ok(reportStart >= 0 && reportEnd > reportStart, "the report step exists");
  const report = workflow.slice(reportStart, reportEnd);
  assert.match(report, /if: always\(\)/, "the report step runs after failures");
  assert.match(report, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/, "gh authenticates with the job token");
  assert.match(report, /LIVE_SMOKE_HTTP_OUTCOME: \$\{\{ steps\.http\.outcome \}\}/);
  assert.match(report, /LIVE_SMOKE_BROWSER_OUTCOME: \$\{\{ steps\.browser\.outcome \}\}/);
  assert.match(workflow, /if: failure\(\)/, "diagnostics upload on failure");
  const live = await read("playwright.live.config.js");
  assert.doesNotMatch(live, /webServer/, "the live config targets the published site, not a local server");
  assert.match(live, /https:\/\/jdooley-clt\.github\.io\/arcade\//);
  assert.match(await read("playwright.config.js"), /testIgnore: \/live-smoke\\\.spec\\\.js\$\//, "the PR gate ignores the live spec");
});

test("Dependabot watches actions and npm weekly and groups development updates", async () => {
  const config = await read(".github/dependabot.yml");
  assert.match(config, /^version: 2$/m);
  assert.equal((config.match(/package-ecosystem: (github-actions|npm)$/gm) ?? []).length, 2);
  assert.equal((config.match(/interval: weekly$/gm) ?? []).length, 2);
  assert.match(config, /development:\n\s+dependency-type: development\n\s+update-types:\n\s+- minor\n\s+- patch/);
});

test("line endings and binaries are normalized by .gitattributes", async () => {
  const attributes = await read(".gitattributes");
  for (const rule of ["* text=auto eol=lf", "*.svg text eol=lf", "*.png binary", "*.webp binary", "*.ttf binary", "*.woff2 binary"]) {
    assert.ok(attributes.split("\n").includes(rule), `.gitattributes has ${rule}`);
  }
});

test("the lockfile resolves every package from the public npm registry with integrity hashes", async () => {
  const lock = JSON.parse(await read("package-lock.json"));
  const manifest = JSON.parse(await read("package.json"));
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(manifest.scripts["test:browser"], "playwright test");
  for (const [name, version] of Object.entries(manifest.devDependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} is pinned exactly`);
    assert.equal(lock.packages[`node_modules/${name}`]?.version, version, `${name} lockfile entry matches`);
  }
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === "") continue;
    assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//, `${path} resolves from registry.npmjs.org`);
    assert.match(entry.integrity, /^sha512-/, `${path} has an integrity hash`);
    assert.equal(entry.dev, true, `${path} is development-only`);
  }
});

test("index.html declares the CSP and referrer policy and SECURITY.md points at private reporting", async () => {
  const html = await read("index.html");
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
  assert.ok(csp, "CSP meta tag present");
  const directives = Object.fromEntries(csp.split(";").map((directive) => {
    const [name, ...values] = directive.trim().split(/\s+/);
    return [name, values.join(" ")];
  }));
  assert.equal(directives["default-src"], "'self'");
  assert.equal(directives["script-src"], "'self'");
  assert.equal(directives["style-src"], "'self'");
  assert.equal(directives["object-src"], "'none'");
  assert.equal(directives["base-uri"], "'none'");
  assert.equal(directives["form-action"], "'none'");
  assert.equal(directives["frame-src"], "'self' https://jdooley-clt.github.io");
  assert.doesNotMatch(csp, /unsafe-(inline|eval)/);
  assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<script"), "the policy precedes the first script");
  assert.match(html, /<meta name="referrer" content="strict-origin-when-cross-origin">/);
  assert.doesNotMatch(html, /\sstyle="|\son[a-z]+="/, "no inline styles or handler attributes");
  for (const anchor of html.match(/<a [^>]*target="_blank"[^>]*>/g)) assert.match(anchor, /rel="noopener noreferrer"/, anchor);

  const policy = await read("SECURITY.md");
  assert.match(policy, /https:\/\/github\.com\/jdooley-clt\/arcade\/security\/advisories\/new/);
  assert.match(policy, /https:\/\/jdooley-clt\.github\.io\/arcade\//);
});
