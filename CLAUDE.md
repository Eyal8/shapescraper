# Agent instructions: Shapescraper

- **Follow the BENO74 studio standard:** `docs/BENO74-STANDARDS.md` (audience/age, ads, consent, purchases, Remove Ads model A, store forms, privacy, branding & launch, release checklist). It overrides general habits.
- That file is a synced copy. Never edit it here; the source is `Eyal8/beno-studio-site` → `standards/BENO74-STANDARDS.md`.
- Game source: `src/game.html` (single file). `npm run build` → `www/`. Test hooks: `www/index.html#shots`.
- Ads mode is baked in at build time (`ADS_TEST`); tester builds use test ads, store builds `real_ads=true`.
- Store screenshots: `python3 design/screens-store.py iphone|iphone-large|android` after `npm run build`.
