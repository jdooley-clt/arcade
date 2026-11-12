import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const MAIN_ONLY = "github.repository == 'jdooley-clt/arcade' && github.event_name != 'pull_request' && github.ref == 'refs/heads/main'";

function topLevelBlock(yaml, key) {
  const match = yaml.match(new RegExp(`^${key}:\\n((?:[ \\t]+.*\\n|\\n)*)`, "m"));
  assert.ok(match, `${key}: block exists`);
  return match[1];
}

test("every workflow action is pinned to a full commit SHA with a version comment", async () => {
  const workflow = await read(".github/workflows/pages.yml");
  const uses = [...workflow.matchAll(/^\s*-?\s*uses:\s*(\S+)(?:\s+#\s*(\S+))?\s*$/gm)];
  assert.ok(uses.length >= 6, "the verify and deploy jobs use actions");
  for (const [line, action, comment] of uses) {
    assert.match(action, /^[a-z0-9-]+\/[a-z0-9-]+@[0-9a-f]{40}$/, `${line.trim()} pins a 40-character commit SHA`);
    assert.match(comment ?? "", /^v\d+(\.\d+)*$/, `${line.trim()} carries the version comment Dependabot updates`);
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

test("Dependabot watches actions and npm weekly and groups development updates", async () => {
  const config = await read(".github/dependabot.yml");
  assert.match(config, /^version: 2$/m);
  assert.equal((config.match(/package-ecosystem: (github-actions|npm)$/gm) ?? []).length, 2);
  assert.equal((config.match(/interval: weekly$/gm) ?? []).length, 2);
  assert.match(config, /development:\n\s+dependency-type: development\n\s+update-types:\n\s+- minor\n\s+- patch/);
});

test("line endings and binaries are normalized by .gitattributes", async () => {
  const attributes = await read(".gitattributes");
  for (const rule of ["* text=auto eol=lf", "*.svg text eol=lf", "*.png binary", "*.ttf binary", "*.woff2 binary"]) {
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
