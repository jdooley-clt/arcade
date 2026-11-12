# GitHub Arcade

**A little less work. A little more play.**

The Commit Cabinet is an ivory-and-pastel candy cabinet for GitHub-themed browser
games. Pick a game on the recessed screen, play the original game, then return to
the library. No accounts, build step, tracking, framework, or runtime dependencies.

## Origins and credits

Created by Christina Warren ([@filmgirl](https://github.com/filmgirl)), currently
maintained by Jeramiah Dooley ([@jdooley-clt](https://github.com/jdooley-clt)).
The original repository is [filmgirl/arcade](https://github.com/filmgirl/arcade).
This copy preserves its full commit history and is published from
[jdooley-clt/arcade](https://github.com/jdooley-clt/arcade). Existing games keep
their original credits; new games credit their own creators.

## Local preview

Install Node.js 22 or newer, then run:

```sh
npm start
```

Open **http://127.0.0.1:4173**. `PORT=8080 npm start` chooses another port.
The preview server binds to loopback by default; for a trusted local network,
use `HOST=0.0.0.0 npm start`. Do not use the preview server as a production server.
The site itself has no runtime dependencies and no build step; `npm ci` installs
only the development-time browser test gate described below. Opening `index.html`
as a `file://` URL will not work because browsers restrict module scripts and
fetching the catalog.

Run the dependency-free catalog, routing, hardening, and preview-server tests:

```sh
npm test
```

Run the browser gate (Playwright + axe-core in Chromium) after `npm ci` and
`npx playwright install chromium`:

```sh
npm run test:browser
```

It starts the preview server on port 4180 (`PLAYWRIGHT_PORT` overrides it),
stubs the remote game pages, and fails on any Content Security Policy violation
or any serious/critical accessibility finding across the library, playing
screen, focus mode, and empty/error catalog states. Pull requests run both
commands in CI before anything can reach `main`.

## Games

| Game | Play | Source |
| --- | --- | --- |
| Mona's Merge Maze | [mona-maze](https://jdooley-clt.github.io/mona-maze/) | [jdooley-clt/mona-maze](https://github.com/jdooley-clt/mona-maze) |
| Flappy Copilot | [flappy-copilot](https://jdooley-clt.github.io/flappy-copilot/) | [jdooley-clt/flappy-copilot](https://github.com/jdooley-clt/flappy-copilot) |
| Mona Breaker | [mona-breaker](https://jdooley-clt.github.io/mona-breaker/) | [jdooley-clt/mona-breaker](https://github.com/jdooley-clt/mona-breaker) |
| Mona Crossing | [mona-crossing](https://jdooley-clt.github.io/mona-crossing/) | [jdooley-clt/mona-crossing](https://github.com/jdooley-clt/mona-crossing) |
| Mona Sweeper | [mona-sweeper](https://jdooley-clt.github.io/mona-sweeper/) | [jdooley-clt/mona-sweeper](https://github.com/jdooley-clt/mona-sweeper) |

The games remain in their own repositories. This project embeds them; it does not
copy or change their implementations. The library and playing-screen headers
share coordinated illustrated covers: a lavender maze and pixel Octocat for
Mona, mint commit pipelines with a pixel Copilot for Flappy, a peach
contribution-graph brick board with the pixel Octocat on a paddle for Mona Breaker,
coral bug streets with an aqua commit river and mint gardens for Mona Crossing,
and a mint contribution-graph board with bug flags for Mona Sweeper.
Flappy's character uses the actual game's sprite layout with the cabinet's pastel
palette.
The original gameplay PNG captures remain in `assets/` as references and catalog
fallback artwork. Cover compositions, titles, genres, and accent colors come
from the catalog. Focus mode hides the cover header to keep the game area clear.
The marquee uses a locally hosted
[Silkscreen](https://github.com/googlefonts/silkscreen) font; its SIL Open Font
License is included in `assets/fonts/OFL.txt`. No fonts are fetched from third
parties at runtime.

The Octocat in `assets/octocat-candy.svg` is adapted from the
[official Octocat](https://octodex.github.com/original/).
`assets/mona-breaker-character.svg` reuses that same pixel Octocat, adding a
paddle and ball, and `assets/mona-sweeper-character.svg` reuses it with a bug
flag and commit tile. Mona Crossing reuses the same character layer, and its cover
includes that silhouette in an original crossing neighborhood. Its original
game, neighborhood, cover composition, and generated sound effects are
[MIT-licensed](https://github.com/jdooley-clt/mona-crossing/blob/main/LICENSE), and
Mona Sweeper is [MIT-licensed](https://github.com/jdooley-clt/mona-sweeper/blob/main/LICENSE);
those licenses do not grant rights to GitHub artwork or trademarks. The Octocat
design is copyright GitHub, Inc. and subject to
[GitHub's artwork terms](https://octodex.github.com/faq/), not a license granted
by this repository. Obtain permission for any new use or redistribution.

## Add a game

**Contributors and coding agents:** start with the
[step-by-step adding-games guide](docs/adding-games.md) and
[agent guardrails](AGENTS.md). The guide covers artwork approval, embedding,
browser acceptance checks, and the expected scope of a new-game PR.

Add an entry to **`games.json`**. No HTML, routing, or JavaScript changes are needed.
Supply an existing artwork URL, or add an image under `assets/`.

```json
{
  "id": "branch-runner",
  "title": "Branch Runner",
  "description": "Jump over merge conflicts on the way to your next release.",
  "category": "Platformer",
  "url": "./games/branch-runner/index.html",
  "repository": "https://github.com/your-name/branch-runner",
  "art": "./assets/branch-runner.svg",
  "accent": "coral",
  "controls": [
    { "keys": "Arrows", "action": "Move" },
    { "keys": "Space / tap", "action": "Jump" }
  ],
  "instructions": "Reach the release flag. Click or tap the game before using keyboard controls.",
  "viewport": {
    "layout": "document",
    "height": 960,
    "mobileHeight": 1100
  }
}
```

This is an example, not an included game. For a local game, put its complete files
in `games/branch-runner/`. For a remote game, replace `url` with its HTTPS URL.
Choose embeddable games you trust and have permission to host.

| Field | Requirement |
| --- | --- |
| `id` | Unique lowercase slug with hyphens; keep it stable to preserve links. |
| `title`, `description`, `instructions` | Non-empty plain text, rendered without HTML interpretation. |
| `url`, `art` | Relative local path or absolute HTTPS URL. Credentials, non-HTTPS remote URLs, protocol-relative URLs, and unsafe protocols are rejected. |
| `coverArt` | Optional illustrated background used by both library cards and player headers; defaults to `art`. Same URL restrictions apply. |
| `coverCharacter` | Optional transparent character layered over both cover surfaces; must be authorized for use. Same URL restrictions apply. |
| `repository` | Absolute HTTPS source link. |
| `controls` | At least one object with non-empty `keys` and `action` strings. |
| `category` | Optional short genre label; defaults to "Arcade game". |
| `accent` | Optional `lavender`, `mint`, or `coral`; defaults to lavender. |
| `viewport.layout` | Optional `document` (default) or `portrait`. |
| `viewport.height` | Optional desktop iframe height, 320–2400 pixels; default 960. |
| `viewport.mobileHeight` | Optional mobile iframe height, 320–2400 pixels; default 1100. |

Relative paths resolve beside `index.html`, **not** beside the JavaScript module.
Use `./assets/...` and `./games/...`, not `/assets/...`, to preserve GitHub Pages
project paths. The Pages workflow publishes `src/`, `assets/`, and the optional
`games/` directory; place local games and all their dependencies in those folders.

`document` gives the whole game page a generous viewport with native internal
scrolling. It does not crop headers, touch controls, minimaps, or audio settings.
`portrait` caps the iframe height to a 3:4 shape at narrow widths and to the supplied
height on larger displays. It suits Flappy Copilot's height-driven canvas.
These are **iframe viewport hints**, not assumptions about the inner game's
canvas. In focus mode, the available screen space determines the viewport instead.
Always test the actual embedded page on desktop and touch devices.

The library uses a responsive grid, with a scrollable screen above four games.
Search appears at six games. Invalid
entries are skipped with specific on-screen errors; valid entries remain playable.
An empty catalog and a failed catalog request have distinct recovery messages.

## Navigation and accessibility

- The small moon/sun button switches the cabinet between light and dark mode.
  Your choice is saved when browser storage is available; otherwise it lasts for
  the current visit. With no explicit choice, the cabinet follows the system
  color scheme. This does not change the themes of embedded games.
- Share `#game/mona-maze` or `#game/flappy-copilot` after the site URL. Browser
  Back/Forward works; `#library` returns to the selector. Unknown links show a
  useful message instead of launching a different game.
- Only the selected game gets an iframe. Returning, switching games, and reloading
  remove the previous iframe to stop that browsing context's simulation and audio.
- Launch and reload focus the game iframe, so Space goes to the game instead of
  activating a cabinet button. **Focus game controls** restores that focus after
  using the toolbar. Return restores focus to the originating game card.
  The cabinet does not steal key events intended for games.
- **Focus mode** removes the cabinet without depending on browser fullscreen.
  **Fullscreen** requests native fullscreen and falls back to focus mode if denied
  or unsupported. **Exit focus** and **Game library** remain in the player toolbar.
  Escape exits native fullscreen; when focus is in a cross-origin game, its own
  Escape binding still belongs to that game (Mona uses it to pause).
- The joystick and coin slot are labeled/decorative, not fake game controls.
  The pastel buttons perform actual cabinet actions. CRT scanlines start **off**,
  have no flicker, and never intercept pointer input. Reduced-motion preferences
  disable cabinet transitions; embedded games control their own motion settings.
- On phones, the playing cabinet drops its decorative surround and uses the full
  page width. Scroll inside document-style games for their full UI.

## Integration limits

No game advertises a shared `postMessage` API, so there is deliberately **no global
pause, mute, score, save state, or leaderboard**. Use each game's own controls.
The cabinet itself plays no audio. Games may play sound after interaction; use
Mona Maze's, Mona Breaker's, or Mona Sweeper's music/effects buttons and `M` key,
Flappy's `M` key, or Mona Crossing's Sound button and `M` key. Mona Crossing has generated sound effects, no music, and sound starts
off; it remembers the game's local setting. The cabinet uses no cookies and
stores only its explicit theme preference in local storage; individual games
may store their own preferences or scores.

Remote pages can change or reject embedding. An iframe `load` event is not proof
that a cross-origin game is healthy. The cabinet reports opening/slow-load/error
states without claiming otherwise and always provides **Open game** in a new tab.
It cannot inspect remote errors, automatically measure remote document height,
or bypass `X-Frame-Options` / CSP `frame-ancestors` restrictions.

Iframes allow scripts, same-origin storage, pointer lock, fullscreen and gamepad;
they do not permit popups or top-level navigation. Games that require other
permissions need a deliberate integration review. `allow-scripts` together with
`allow-same-origin` is **not a security boundary for games hosted on the cabinet's
own origin**; host only trusted local games. No game-to-parent messaging is used.

## Security posture

The cabinet declares its Content Security Policy in a `<meta http-equiv>` tag in
`index.html`, because GitHub Pages cannot set response headers:

```text
default-src 'self'; img-src 'self' data: https://jdooley-clt.github.io;
frame-src 'self' https://jdooley-clt.github.io; script-src 'self';
style-src 'self'; font-src 'self'; connect-src 'self';
base-uri 'none'; form-action 'none'; object-src 'none'
```

- Scripts, styles, fonts, and the catalog load only from the site's own origin;
  there is no inline script, inline `style=""` attribute, `unsafe-inline`, or
  `unsafe-eval`. The player sets its per-game `--game-height` custom properties
  through the CSSOM (`style.setProperty`), which the policy does not restrict;
  the browser gate asserts zero `securitypolicyviolation` events across launch,
  theme toggle, reload, focus mode, and return.
- `frame-src` limits embeds to the cabinet's origin and `https://jdooley-clt.github.io`.
  The explicit host keeps the live games embeddable from the local preview
  server, where `'self'` is `127.0.0.1`. `src/catalog.js` additionally rejects
  `javascript:`, `data:`, `http:`, protocol-relative, credentialed, and
  `file:` game URLs before anything is rendered (see `test/catalog.test.js`).
- A `<meta>` policy cannot carry `frame-ancestors`, `sandbox`, or reporting
  directives, so the cabinet does not claim clickjacking protection for itself.
- `<meta name="referrer" content="strict-origin-when-cross-origin">` governs the
  cabinet's own requests and outbound links; every `target="_blank"` link also
  carries `rel="noopener noreferrer"`, and game iframes use
  `referrerpolicy="no-referrer"`.

Game iframes are created with
`sandbox="allow-scripts allow-same-origin allow-pointer-lock"` and
`allow="fullscreen; gamepad"`, and are removed from the document on return,
switch, or reload rather than hidden.

- `allow-same-origin` is required because without it the frame gets an opaque
  origin: all five games keep scores or settings in their own `localStorage`,
  which an opaque-origin frame cannot read or write.
- The games at `https://jdooley-clt.github.io/<game>/` are project Pages sites
  of the same account, so they share the cabinet's origin,
  `https://jdooley-clt.github.io`. That makes the sandbox a guard rail for
  well-behaved games, not an isolation boundary: a same-origin script could in
  principle reach the parent document. Isolation therefore rests on the games
  being separately maintained, reviewed repositories under the same account,
  each deployed by its own workflow, plus the sandbox denying forms, popups,
  modals, downloads, and top-level navigation to anything that is not
  deliberately granted. Games hosted under this repository's `games/` directory
  would be same-origin for the same reason, which is why only trusted local
  games belong there.
- Embedding a game from a different origin would be isolated by the sandbox in
  the usual way, but would also need a `frame-src` change and an integration
  review; do not widen the policy or the sandbox to make a single game work.

`SECURITY.md` explains what is in scope and how to report a vulnerability
privately. Pull requests run `npm test` and `npm run test:browser` in the
`verify` job of `.github/workflows/pages.yml`; every action in that workflow is
pinned to a full commit SHA, and `.github/dependabot.yml` keeps the pins and the
development dependencies current.

## GitHub Pages deployment

The public URL is **`https://jdooley-clt.github.io/arcade/`**, published from
[`jdooley-clt/arcade`](https://github.com/jdooley-clt/arcade). GitHub Pages uses the
repository name as the project-site path. Keep the `arcade` name and leave the
individual game repositories unchanged.

1. In **Settings → Pages**, choose **GitHub Actions** as the
   build and deployment source.
2. Push or merge the site to `main`, or run **Deploy arcade to GitHub Pages**
   manually from the Actions tab.
3. The `verify` job runs `npm test` and the Playwright/axe browser gate, stages
   only static site files, confirms nothing from `node_modules` or the test
   tooling is staged, and uploads the Pages artifact; the `deploy` job then
   publishes it. Pull requests run `verify` only. Use the successful
   deployment's URL.

The site is live only once Pages has been enabled and deployment succeeds.
Adding the workflow alone does **not**
publish the site. Hash routes do not require rewrites or a custom 404 page.
Any ordinary static HTTP host also works; serve the files at the site root or
a subpath with their relative directory structure intact.

## Project map

```text
index.html              Cabinet structure, CSP/referrer policy, and accessible UI
styles.css              Enamel, screen, controls, responsive/focus layouts
games.json              The only catalog to edit when adding games
src/catalog.js          Catalog validation and hash parsing
src/app.js              Rendering, iframe lifecycle, navigation and focus
assets/                 Gameplay screenshots, cover artwork, and cabinet favicon
scripts/serve.mjs        Dependency-free local preview server
test/catalog.test.js    Native Node regression tests
test/serve.test.js      Local preview HTTP smoke test
test/hardening.test.js  Workflow pins, CSP, lockfile, and policy checks
test/browser/           Playwright + axe-core browser gate
playwright.config.js    Browser gate configuration (preview server on 4180)
.github/workflows/      Verify-then-deploy GitHub Pages workflow
.github/dependabot.yml  Weekly action-pin and dev-dependency updates
.gitattributes          LF line endings; binary artwork and fonts
SECURITY.md             Scope and private vulnerability reporting
AGENTS.md              Guardrails for coding agents
docs/adding-games.md   End-to-end new-game contribution guide
```

Independent fan project by [@filmgirl](https://github.com/filmgirl). Not affiliated
with or endorsed by GitHub.
