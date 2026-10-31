# Design: landing

## Overview
Final shape depends on the verdict (task 0). The frame below holds for any variant.

```
apps/web/src/landing/LandingPage.tsx    composition root; reads usePlane() + health
apps/web/src/landing/Intro.tsx          skippable intro (<= 4 s), respects data-motion
apps/web/src/landing/Room.tsx           the cellar composition: plates as layered backgrounds
apps/web/src/landing/StatusObjects.tsx  ON AIR lightbox, bulb, dial: bound to plane/health
apps/web/src/landing/Enter.tsx          primary action -> /creator transition
apps/web/src/landing/fx/*.ts            optional WebGL/canvas effects (lazy chunk), each <= 400 lines
apps/web/src/landing/landing.module.css role tokens only
assets/plates/*.png|webp                moved from the contest staging, provenance recorded
assets/_incoming/landing-winner/        reference copy of the winning prototype (not imported)
apps/web/e2e/landing.visual.spec.ts     Playwright screenshots (pnpm test:visual)
```

## Porting rules
- Recompose, do not transcribe: the prototype's inline styles and literal colours become role
  tokens; new roles go into `roles.json` and both themes (never rename existing roles).
- Plates are served as optimised WebP (<= 300 KB each at 1920 wide) with the PNG kept only in
  `assets/_incoming/`; images used as WebGL textures load over HTTP (no `file://` issue in the app).
- Effects that cost frames (grain, flicker, fog) live in `fx/` behind `data-motion` and a
  lazy import; the static composition renders first (LCP is a plate, not a canvas).
- Status objects subscribe to the same health/plane hooks as the stage, so "the bulb dies" means
  the same thing everywhere.

## Testing strategy
- Visual: Playwright at 1600x900, both themes, reduced motion, replay plane; 2% tolerance;
  baselines committed under `apps/web/e2e/__screenshots__/`.
- Component: intro skip on key/click; intro hands over within 4 s (fake timers); intro does not
  navigate if the user already navigated; reduced motion renders no animated elements.
- Lighthouse a11y >= 90 checked manually on the deployed URL and recorded in `docs/kiro-log.md`.
