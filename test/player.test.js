import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { gameFromHash, validateCatalog } from "../src/catalog.js";

const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const catalog = JSON.parse(await readFile(new URL("../games.json", import.meta.url), "utf8"));
const catalogImport = 'import { gameFromHash, validateCatalog } from "./catalog.js";';

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.classes = new Set();
    this.hidden = false;
    this.value = "";
    this.text = "";
    this.style = { setProperty() {} };
    this.classList = {
      add: (name) => this.classes.add(name),
      remove: (name) => this.classes.delete(name),
      toggle: (name, force) => {
        const on = force ?? !this.classes.has(name);
        if (on) this.classes.add(name);
        else this.classes.delete(name);
        return on;
      }
    };
  }
  get className() { return [...this.classes].join(" "); }
  set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get textContent() { return this.children.length ? this.children.map((child) => child.textContent).join("") : this.text; }
  set textContent(value) { this.children = []; this.text = String(value); }
  get firstElementChild() { return this.children[0] ?? null; }
  get lastElementChild() { return this.children.at(-1) ?? null; }
  append(...nodes) {
    for (const node of nodes) {
      if (node instanceof FakeFragment) {
        this.children.push(...node.children);
        node.children = [];
      } else this.children.push(node);
    }
  }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  querySelector(selector) { return this.children.find((child) => child.tagName === selector) ?? null; }
  addEventListener() {}
  focus() {}
  scrollIntoView() {}
}

class FakeFragment extends FakeNode {}

// Runs the player against a fake document and the shipped catalog, starting at `hash`.
async function boot(hash) {
  const elements = new Map();
  const errors = [];
  const windowListeners = {};
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, new FakeNode("div"));
    return elements.get(id);
  };
  const document = {
    body: new FakeNode("body"),
    fullscreenElement: null,
    title: "",
    getElementById: byId,
    querySelector: () => new FakeNode("a"),
    createElement: (tagName) => new FakeNode(tagName),
    createDocumentFragment: () => new FakeFragment("#fragment"),
    createTextNode: (text) => ({ textContent: text }),
    addEventListener() {}
  };
  const location = new URL(`https://jdooley-clt.github.io/arcade/${hash}`);
  const window = { addEventListener: (name, handler) => { windowListeners[name] = handler; } };
  const fetch = async () => ({ ok: true, json: async () => structuredClone(catalog) });
  const console = { warn() {}, error: (...args) => errors.push(args) };
  assert.ok(source.includes(catalogImport), "app.js imports the catalog helpers the test provides");
  await runInNewContext(`(async () => {${source.replace(catalogImport, "")}\n})()`, {
    document, window, location, fetch, console, URL, gameFromHash, validateCatalog,
    setTimeout: () => 0,
    clearTimeout() {}
  });
  assert.deepEqual(errors, []);
  return {
    panel: byId,
    navigate(nextHash) {
      location.hash = nextHash;
      windowListeners.hashchange();
    }
  };
}

const sourceLinks = (panel) => panel.children.filter((child) => child.className === "game-repo");
const repositoryOf = (id) => catalog.find((game) => game.id === id).repository;

test("both player guides end with a Source & credits link to the game's repository", async () => {
  const app = await boot("#game/mona-maze");
  for (const id of ["instruction-content", "player-guide"]) {
    const panel = app.panel(id);
    const links = sourceLinks(panel);
    assert.equal(links.length, 1, `${id} has exactly one source link`);
    const [link] = links;
    assert.equal(panel.lastElementChild, link, `${id} places the link after the controls and instructions`);
    assert.equal(link.tagName, "a");
    assert.equal(link.textContent, "Source & credits ↗");
    assert.equal(link.href, repositoryOf("mona-maze"));
    assert.equal(link.target, "_blank");
    assert.equal(link.rel, "noopener noreferrer");
  }
});

test("switching games and returning to the library re-render the link without duplicates", async () => {
  const app = await boot("#game/mona-maze");
  app.navigate("#game/flappy-copilot");
  for (const id of ["instruction-content", "player-guide"]) {
    const links = sourceLinks(app.panel(id));
    assert.equal(links.length, 1, id);
    assert.equal(links[0].href, repositoryOf("flappy-copilot"));
  }
  app.navigate("#library");
  assert.equal(sourceLinks(app.panel("instruction-content")).length, 0);
});

test("the player no longer labels the link Game source", () => {
  assert.doesNotMatch(source, /Game source/);
});
