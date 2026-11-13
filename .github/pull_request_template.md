## Summary

<!-- What changes and why. Link related issues with "Part of #..." unless this PR should close them. -->

## Verification

- [ ] `npm test` passes.
- [ ] `npm run test:browser` passes (after `npm ci` and `npx playwright install chromium`).
- [ ] Existing credits to Christina Warren (@filmgirl) are unchanged.

## New-game checklist

<!-- Delete this section if the PR does not add or update a game. It mirrors docs/adding-games.md section 5. -->

- [ ] The entry in `games.json` has a stable lowercase `id`; no existing ID or entry changed.
- [ ] Shipping artwork lives under `assets/` (raster captures at or under 25 KB) with attribution and license terms recorded.
- [ ] The README game list credits the new game's own creator; existing credits are untouched.
- [ ] The standalone page and the source repository README link back to `https://jdooley-clt.github.io/arcade/`.
- [ ] The library shows the title, description, both cover layers, and the correct count; `#game/<id>` and Back/Forward work.
- [ ] Launch and Reload focus the iframe (Space stays in the game); Return restores focus to the card; at most one iframe ever exists.
- [ ] 320 px and 390 px widths have no horizontal overflow; Focus mode and fullscreen keep accessible exits.
- [ ] `builtWith`, model, tool, and date fields were **not** populated by a coding session or contributor; only the repository owner adds provenance, by hand, after launch.
- [ ] Browser coverage is reported honestly: real touch-device testing is distinguished from emulation, and untested states are listed as limitations.
