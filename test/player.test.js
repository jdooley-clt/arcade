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
    this.listeners = {};
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
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
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
  addEventListener(name, handler) { this.listeners[name] = handler; }
  dispatch(name) { this.listeners[name]?.({ target: this }); }
  focus() {}
  scrollIntoView() {}
}

class FakeFragment extends FakeNode {}

// Runs the player against a fake document and the shipped catalog (or `entries`), starting at `hash`.
async function boot(hash, entries = catalog) {
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
  const fetch = async () => ({ ok: true, json: async () => structuredClone(entries) });
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

// Provenance fixtures reuse a shipped entry's artwork and URLs under fictional ids and generic placeholder names.
function provenanceCatalog(models = ["Example Model A", "Example Model B"]) {
  const [base, ...rest] = catalog;
  const sample = (id, title, extra = {}) => ({ ...structuredClone(base), id, title, ...extra });
  return [
    sample("example-a", "Example A", {
      builtWith: {
        model: models[0],
        tool: "Example Tool",
        creator: { name: "Example Creator", url: "https://example.com/creator" },
        notes: "Prototyped from a one-paragraph brief, then tuned by hand.",
        link: "https://example.com/notes"
      }
    }),
    sample("example-b", "Example B", { builtWith: { model: models[1] } }),
    sample("example-c", "Example C", { builtWith: { tool: "Example Tool", creator: { name: "Example Creator" } } }),
    sample("example-d", "Example D"),
    ...rest.slice(0, 2)
  ];
}

const cards = (app) => app.panel("game-grid").children;
const cardIds = (app) => cards(app).map((card) => card.dataset.gameId);
const provenanceOf = (card) => card.children[1].children.filter((child) => child.className === "game-provenance");
const search = (app, query) => {
  app.panel("game-search").value = query;
  app.panel("game-search").dispatch("input");
};

test("the shipped catalog renders no provenance anywhere", async () => {
  const app = await boot("#game/mona-maze");
  assert.ok(cards(app).length > 0);
  for (const card of cards(app)) assert.deepEqual(provenanceOf(card), [], card.dataset.gameId);
  assert.equal(app.panel("cover-provenance").hidden, true);
  assert.deepEqual(app.panel("cover-provenance").children, []);
  assert.equal(app.panel("model-filter").hidden, true);
  assert.deepEqual(app.panel("model-filter").children, []);
});

test("cards show a Built with line only for games that declare builtWith", async () => {
  const app = await boot("#library", provenanceCatalog());
  const byId = Object.fromEntries(cards(app).map((card) => [card.dataset.gameId, provenanceOf(card)]));
  assert.deepEqual(byId["example-a"].map((node) => node.textContent), ["Built with Example Model A · Example Tool"]);
  assert.deepEqual(byId["example-b"].map((node) => node.textContent), ["Built with Example Model B"]);
  assert.deepEqual(byId["example-c"].map((node) => node.textContent), ["Built with Example Tool"]);
  assert.deepEqual(byId["example-d"], []);
  const [, descriptionA, launchA, pillA] = cards(app)[0].children[1].children;
  assert.equal(descriptionA.className, "game-description");
  assert.equal(launchA.className, "launch-label", "the PLAY label keeps its place before the provenance pill");
  assert.equal(pillA.tagName, "span", "the pill is static text inside the card button, not a nested control");
});

test("the playing header renders creator, notes and link with safe external targets and clears for other games", async () => {
  const app = await boot("#game/example-a", provenanceCatalog());
  const panel = app.panel("cover-provenance");
  assert.equal(panel.hidden, false);
  const [line, notes, link] = panel.children;
  assert.equal(panel.children.length, 3);
  assert.equal(line.className, "provenance-line");
  assert.equal(line.textContent, "Built with Example Model A · Example Tool by Example Creator");
  const creator = line.children.find((child) => child.className === "provenance-creator");
  assert.equal(creator.tagName, "a");
  assert.equal(creator.href, "https://example.com/creator");
  assert.equal(creator.target, "_blank");
  assert.equal(creator.rel, "noopener noreferrer");
  assert.equal(notes.className, "provenance-notes");
  assert.equal(notes.textContent, "Prototyped from a one-paragraph brief, then tuned by hand.");
  assert.equal(link.tagName, "a");
  assert.equal(link.textContent, "How it was built ↗");
  assert.equal(link.href, "https://example.com/notes");
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");

  app.navigate("#game/example-c");
  assert.equal(panel.hidden, false);
  assert.equal(panel.children.length, 1);
  assert.equal(panel.children[0].textContent, "Built with Example Tool by Example Creator");
  const unlinked = panel.children[0].children.find((child) => child.className === "provenance-creator");
  assert.equal(unlinked.tagName, "span", "a creator without a url is plain text, not a dead link");

  app.navigate("#game/example-d");
  assert.equal(panel.hidden, true);
  assert.deepEqual(panel.children, []);

  app.navigate("#game/example-b");
  assert.equal(panel.hidden, false);
  assert.deepEqual(panel.children.map((node) => node.textContent), ["Built with Example Model B"]);
});

test("search matches provenance fields in addition to title, genre and description", async () => {
  const app = await boot("#library", provenanceCatalog());
  assert.equal(cards(app).length, 6);
  search(app, "example tool");
  assert.deepEqual(cardIds(app), ["example-a", "example-c"]);
  search(app, "Example Creator");
  assert.deepEqual(cardIds(app), ["example-a", "example-c"]);
  search(app, "one-paragraph brief");
  assert.deepEqual(cardIds(app), ["example-a"]);
  search(app, "model b");
  assert.deepEqual(cardIds(app), ["example-b"]);
  search(app, "");
  assert.equal(cards(app).length, 6);
  assert.equal(app.panel("empty-results").hidden, true);
});

test("model chips appear with two or more models, filter the grid and stay hidden otherwise", async () => {
  const app = await boot("#library", provenanceCatalog());
  const bar = app.panel("model-filter");
  assert.equal(bar.hidden, false);
  assert.deepEqual(bar.children.map((chip) => chip.textContent), ["All", "Example Model A", "Example Model B"]);
  for (const chip of bar.children) {
    assert.equal(chip.tagName, "button");
    assert.equal(chip.type, "button");
  }
  assert.deepEqual(bar.children.map((chip) => chip.getAttribute("aria-pressed")), ["true", "false", "false"]);

  bar.children[2].dispatch("click");
  assert.deepEqual(cardIds(app), ["example-b"]);
  assert.deepEqual(bar.children.map((chip) => chip.getAttribute("aria-pressed")), ["false", "false", "true"]);

  search(app, "example");
  assert.deepEqual(cardIds(app), ["example-b"], "search and the model filter combine");
  bar.children[0].dispatch("click");
  assert.deepEqual(cardIds(app), ["example-a", "example-b", "example-c", "example-d"]);
  assert.deepEqual(bar.children.map((chip) => chip.getAttribute("aria-pressed")), ["true", "false", "false"]);

  const single = await boot("#library", provenanceCatalog(["Example Model", "Example Model"]));
  assert.equal(single.panel("model-filter").hidden, true);
  assert.deepEqual(single.panel("model-filter").children, []);
  assert.equal(cards(single).length, 6);
});
