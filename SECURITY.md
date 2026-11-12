# Security policy

GitHub Arcade is a static, client-side site: `index.html`, `styles.css`,
`games.json`, and the scripts under `src/`, published to GitHub Pages at
<https://jdooley-clt.github.io/arcade/>. There is no backend, account system,
telemetry, analytics, or third-party script. The cabinet sets no cookies and
stores one value in `localStorage`: the explicit light/dark theme preference
(`github-arcade-theme`). The only npm packages are development dependencies for
the test gate (`@playwright/test`, `@axe-core/playwright`); nothing from npm is
shipped to the site.

## Supported versions

| Version                                                   | Supported |
| --------------------------------------------------------- | --------- |
| `main` and the live GitHub Pages site deployed from it    | Yes       |
| Forks, mirrors, local copies, and older commits           | No        |

Fixes land on `main` through pull requests; merging to `main` redeploys the site.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
vulnerability reporting for this repository:

<https://github.com/jdooley-clt/arcade/security/advisories/new>

Include the affected URL or file, steps to reproduce, the browser and version
you used, and the impact you observed. Reports are acknowledged and discussed in
the advisory thread, and credit is given in the published advisory unless you
prefer otherwise.

## Scope

In scope:

- The cabinet itself: `index.html`, `styles.css`, `src/*.js`, the catalog
  validation in `src/catalog.js`, the Content Security Policy and iframe
  sandbox posture, and the GitHub Actions workflow and dependency pins.
- The local preview server, `scripts/serve.mjs`, in its default loopback
  (`127.0.0.1`) configuration.

Out of scope, or report elsewhere:

- The games. Each game is an independent repository and site, for example
  `https://github.com/jdooley-clt/mona-maze`; report game issues to that
  repository. The cabinet embeds games in a sandboxed iframe and has no
  messaging bridge to them.
- GitHub Pages and GitHub.com infrastructure, which belong to GitHub's own
  program at <https://bounty.github.com>.
- Findings that require a modified `games.json` on the maintainer's origin, a
  browser extension, or an already compromised device.
- HTTP response headers that a GitHub Pages project cannot set, such as
  `frame-ancestors`, `X-Frame-Options`, or HSTS. The cabinet declares its
  policy in a `<meta>` tag instead; the README's security posture section
  documents that trade-off.

## What the cabinet does and does not do

- No backend, authentication, or server-side code.
- No telemetry, analytics, or remote scripts; scripts, styles, fonts, and
  cabinet artwork load only from the site's own origin under the CSP in
  `index.html`.
- No cookies; `localStorage` holds only the theme preference.
- Game iframes run with
  `sandbox="allow-scripts allow-same-origin allow-pointer-lock"`,
  `allow="fullscreen; gamepad"`, and `referrerpolicy="no-referrer"`, so games
  cannot open popups, submit forms, or navigate the cabinet.
