import { gameFromHash, validateCatalog } from "./catalog.js";

const $ = (id) => document.getElementById(id);
const base = new URL("./", location.href);
const catalogUrl = new URL("games.json", base);
let games = [];
let activeGame = null;
let loadTimer;
let focusMode = false;
let nativeFullscreen = false;
let returnId = null;
let modelFilter = null;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function notice(id, message) {
  $(id).textContent = message;
  $(id).hidden = !message;
}

function gameArt(game, source = game.art, className = "game-art") {
  const image = element("img", className);
  image.src = source;
  image.alt = "";
  image.width = 640;
  image.height = 360;
  image.loading = "lazy";
  image.decoding = "async";
  image.addEventListener("error", () => {
    image.hidden = true;
    console.warn(`Artwork could not be loaded for ${game.id}: ${source}`);
  });
  return image;
}

function gameArtwork(game) {
  const artwork = document.createDocumentFragment();
  artwork.append(gameArt(game, game.coverArt ?? game.art));
  if (game.coverCharacter) {
    artwork.append(gameArt(game, game.coverCharacter, "cover-character"));
  }
  return artwork;
}

function externalLink(className, text, href) {
  const link = element("a", className, text);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

// Provenance is plain catalog text rendered through textContent; omitted entries add nothing to the DOM.
function provenanceText(built) {
  return `Built with ${[built.model, built.tool].filter(Boolean).join(" · ")}`;
}

function searchText(game) {
  const built = game.builtWith;
  return [game.title, game.category, game.description, built?.model, built?.tool, built?.creator?.name, built?.notes]
    .filter(Boolean).join(" ").toLowerCase();
}

function renderProvenance(game) {
  const panel = $("cover-provenance");
  const built = game.builtWith;
  panel.hidden = !built;
  if (!built) {
    panel.replaceChildren();
    return;
  }
  const line = element("p", "provenance-line", provenanceText(built));
  if (built.creator) {
    line.append(document.createTextNode(" by "));
    line.append(built.creator.url
      ? externalLink("provenance-creator", built.creator.name, built.creator.url)
      : element("span", "provenance-creator", built.creator.name));
  }
  const nodes = [line];
  if (built.notes) nodes.push(element("p", "provenance-notes", built.notes));
  if (built.link) nodes.push(externalLink("provenance-link", "How it was built ↗", built.link));
  panel.replaceChildren(...nodes);
}

// Model chips appear only once two or more games name different models.
function renderModelFilter() {
  const bar = $("model-filter");
  const models = [...new Set(games.map((game) => game.builtWith?.model).filter(Boolean))];
  modelFilter = null;
  bar.hidden = models.length < 2;
  if (bar.hidden) {
    bar.replaceChildren();
    return;
  }
  bar.replaceChildren(...[null, ...models].map((model) => {
    const chip = element("button", "filter-chip", model ?? "All");
    chip.type = "button";
    chip.setAttribute("aria-pressed", String(model === modelFilter));
    chip.addEventListener("click", () => {
      modelFilter = model;
      for (const node of bar.children) node.setAttribute("aria-pressed", String(node === chip));
      renderCatalog();
    });
    return chip;
  }));
}

function renderCatalog() {
  const query = $("game-search").value.trim().toLowerCase();
  const shown = games.filter((game) => searchText(game).includes(query) && (modelFilter === null || game.builtWith?.model === modelFilter));
  $("game-grid").replaceChildren(...shown.map((game) => {
    const card = element("button", `game-card ${game.accent}`);
    card.type = "button";
    card.dataset.gameId = game.id;
    const art = element("span", "art-wrap");
    art.append(gameArtwork(game), element("span", "game-category micro", game.category));
    const info = element("span", "game-info");
    const title = element("span", "game-name", game.title);
    const description = element("span", "game-description", game.description);
    const launch = element("span", "launch-label", "PLAY");
    const arrow = element("span", "launch-arrow", "↗");
    arrow.setAttribute("aria-hidden", "true");
    launch.append(arrow);
    info.append(title, description, launch);
    if (game.builtWith) info.append(element("span", "game-provenance", provenanceText(game.builtWith)));
    card.append(art, info);
    card.addEventListener("click", () => { location.hash = `game/${game.id}`; });
    return card;
  }));
  $("empty-results").hidden = shown.length > 0 || games.length === 0;
  $("library").classList.toggle("has-many", games.length > 4);
  $("library-footnote").textContent = games.length > 4 ? "Scroll for more games" : "Made for the joy of it ♡";
  $("game-count").textContent = `${games.length} GAME${games.length === 1 ? "" : "S"} / ALWAYS FREE`;
  $("search-wrap").hidden = games.length < 6;
}

function guide(game) {
  const fragment = document.createDocumentFragment();
  const list = element("dl", "controls-list");
  for (const { keys, action } of game.controls) {
    const pair = element("div");
    const term = element("dt");
    term.append(element("kbd", "", keys));
    pair.append(term, element("dd", "", action));
    list.append(pair);
  }
  const repo = externalLink("game-repo", "Source & credits ↗", game.repository);
  fragment.append(list, element("p", "game-instructions", game.instructions), repo);
  return fragment;
}

function removeGame() {
  clearTimeout(loadTimer);
  $("frame-host").replaceChildren();
}

function mountGame(game) {
  removeGame();
  const iframe = element("iframe");
  iframe.title = `${game.title} — interactive game`;
  iframe.src = game.url;
  iframe.referrerPolicy = "no-referrer";
  // No bridge is assumed. Sandbox isolates remote games without breaking scripts/storage.
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-pointer-lock");
  iframe.setAttribute("allow", "fullscreen; gamepad");
  $("frame-host").dataset.layout = game.viewport.layout;
  $("frame-host").style.setProperty("--game-height", `${game.viewport.height}px`);
  $("frame-host").style.setProperty("--mobile-height", `${game.viewport.mobileHeight}px`);
  notice("frame-status", `Opening ${game.title}… If it stays blank, use Open game.`);
  iframe.addEventListener("load", () => {
    if (iframe !== $("frame-host").firstElementChild) return;
    clearTimeout(loadTimer);
    notice("frame-status", "Blank screen or trouble playing? Use Open game. Audio and pause are controlled inside the game.");
  });
  iframe.addEventListener("error", () => {
    if (iframe !== $("frame-host").firstElementChild) return;
    clearTimeout(loadTimer);
    notice("frame-status", "The embedded game could not be loaded. Try Reload game or Open game.");
  });
  $("frame-host").append(iframe);
  iframe.focus({ preventScroll: true });
  loadTimer = setTimeout(() => {
    notice("frame-status", "The game is taking longer than expected. Try Open game or Reload game.");
  }, 15000);
}

function launch(game) {
  if (activeGame?.id === game.id) return;
  activeGame = game;
  returnId = game.id;
  $("library").hidden = true;
  $("player").hidden = false;
  $("cabinet").classList.add("is-playing");
  $("cabinet").dataset.game = game.id;
  $("instruction-title").textContent = game.title;
  $("instruction-content").replaceChildren(guide(game));
  $("player-guide").replaceChildren(guide(game));
  $("game-cover").className = `game-cover ${game.accent}`;
  $("cover-image").replaceChildren(gameArtwork(game));
  if (game.coverCharacter) {
    $("game-cover").classList.add("has-character");
  }
  $("cover-category").textContent = game.category;
  $("cover-description").textContent = game.description;
  renderProvenance(game);
  $("player-title").textContent = game.title;
  $("compact-player-title").textContent = game.title;
  $("open-game").href = game.url;
  $("deck-focus").disabled = false;
  document.title = `${game.title} · GitHub Arcade`;
  mountGame(game);
  $("screen").scrollIntoView({ block: "start", behavior: "instant" });
}

async function setFocusMode(enabled) {
  focusMode = enabled;
  $("cabinet").classList.toggle("is-focused", enabled);
  document.body.classList.toggle("focus-active", enabled);
  $("focus-button").textContent = enabled ? "Exit focus" : "Focus mode";
  $("focus-button").setAttribute("aria-pressed", String(enabled));
  $("deck-focus").setAttribute("aria-pressed", String(enabled));
  if (!enabled && document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch (error) {
      notice("mode-status", "Use your browser's fullscreen exit control to leave fullscreen.");
      console.warn("Exiting fullscreen failed.", error);
    }
  }
}

function showLibrary() {
  const hadGame = activeGame !== null;
  removeGame();
  activeGame = null;
  setFocusMode(false);
  notice("mode-status", "");
  $("library").hidden = false;
  $("player").hidden = true;
  $("cabinet").classList.remove("is-playing");
  delete $("cabinet").dataset.game;
  $("deck-focus").disabled = true;
  $("player-guide").hidden = true;
  $("guide-toggle").setAttribute("aria-expanded", "false");
  $("instruction-title").replaceChildren(document.createTextNode("Pick a game. Take a play break."));
  $("instruction-content").replaceChildren(
    element("p", "", "Choose a game on the screen to get started."),
    element("p", "", "Every game has its own controls. Your quick guide will appear right here.")
  );
  document.title = "GitHub Arcade — The Commit Cabinet";
  if (hadGame) {
    const card = Array.from($("game-grid").children).find((node) => node.dataset.gameId === returnId);
    (card ?? $("screen")).focus({ preventScroll: true });
    $("screen").scrollIntoView({ block: "start", behavior: "instant" });
  }
}

function route() {
  const result = gameFromHash(location.hash);
  const game = games.find((entry) => entry.id === result.id);
  notice("catalog-notice", result.error ?? (result.id && !game
    ? "That game is not in this cabinet. Choose one below."
    : games.length === 0 ? "This cabinet is empty. Add a game to games.json to get started." : ""));
  if (game) launch(game);
  else showLibrary();
}

document.querySelector(".skip-link").addEventListener("click", (event) => {
  event.preventDefault();
  $("screen").focus();
  $("screen").scrollIntoView({ block: "start", behavior: "instant" });
});
$("game-search").addEventListener("input", renderCatalog);
$("return-button").addEventListener("click", () => { location.hash = "library"; });
$("deck-library").addEventListener("click", () => {
  if (activeGame) location.hash = "library";
  else {
    $("game-grid").querySelector("button")?.focus();
    $("screen").scrollIntoView({ block: "start", behavior: "instant" });
  }
});
for (const id of ["focus-button", "deck-focus"]) {
  $(id).addEventListener("click", () => {
    notice("mode-status", "");
    setFocusMode(!focusMode);
    $("focus-button").focus({ preventScroll: true });
  });
}
$("fullscreen-button").addEventListener("click", async () => {
  setFocusMode(true);
  notice("mode-status", "");
  if (document.fullscreenElement) return;
  if (!$("cabinet").requestFullscreen) {
    notice("mode-status", "Fullscreen is unavailable in this browser. Focus mode is on; use Exit focus to return.");
    return;
  }
  try {
    await $("cabinet").requestFullscreen();
  } catch (error) {
    notice("mode-status", "Fullscreen could not be opened. Focus mode is on; use Exit focus to return.");
    console.warn("Fullscreen request failed.", error);
  }
});
document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement === $("cabinet")) nativeFullscreen = true;
  else if (nativeFullscreen) {
    nativeFullscreen = false;
    setFocusMode(false);
  }
});
document.addEventListener("keydown", (event) => {
  // Keys inside a cross-origin game belong to it (including Mona's pause key).
  if (event.key === "Escape" && focusMode && !document.fullscreenElement) {
    setFocusMode(false);
    $("focus-button").focus({ preventScroll: true });
  }
});
$("effects-button").addEventListener("click", () => {
  const enabled = $("effects-button").getAttribute("aria-pressed") !== "true";
  $("effects-button").setAttribute("aria-pressed", String(enabled));
  $("effects-button").lastElementChild.textContent = `CRT effect: ${enabled ? "on" : "off"}`;
  $("screen").classList.toggle("crt-on", enabled);
});
$("guide-toggle").addEventListener("click", () => {
  const enabled = $("player-guide").hidden;
  $("player-guide").hidden = !enabled;
  $("guide-toggle").setAttribute("aria-expanded", String(enabled));
});
$("reload-game").addEventListener("click", () => {
  if (activeGame) mountGame(activeGame);
});
$("enter-game").addEventListener("click", () => {
  $("frame-host").querySelector("iframe")?.focus();
});
window.addEventListener("hashchange", route);

try {
  const response = await fetch(catalogUrl);
  if (!response.ok) throw new Error(`Catalog request returned HTTP ${response.status}.`);
  const result = validateCatalog(await response.json(), base);
  games = result.games;
  if (result.errors.length) {
    notice("catalog-error", `Some games could not be added: ${result.errors.join(" ")} Fix games.json and refresh.`);
  } else if (games.length === 0) {
    notice("catalog-notice", "This cabinet is empty. Add a game to games.json to get started.");
  }
  renderModelFilter();
  renderCatalog();
  route();
} catch (error) {
  notice("catalog-error", `The library could not be opened. ${error.message} Refresh to retry. If previewing locally, run npm start instead of opening index.html directly.`);
  console.error("Catalog loading failed.", error);
} finally {
  $("catalog-loading").hidden = true;
}
