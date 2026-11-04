# Implementation plan: avatar-reach

- [x] 0. Pages, shell, stubs (director)
  - PageIds and `offStrip`, the three pages, Shell branches (overlay bare), stub pages, stub
    `player.ts` with final signatures, stub `playable.ts`; gates green.
  - _Requirements: 5.1_

- [x] 1. Player core and playable (packages/avatar, apps/web/src/reach/playable.ts)
  - As design "Player core" and "Playable"; `attachAudio` takes a MediaStream.
  - _Requirements: 1.1-1.4_

- [ ] 2. Embed (apps/web/src/reach/embed, apps/web/vite.embed.config.ts, apps/web/package.json)
  - As design "Embed"; docs/pack-format.md gains an "Embed" section.
  - _Requirements: 2.1-2.4_

- [ ] 3. Overlay (apps/web/src/reach/overlay)
  - As design "Overlay".
  - _Requirements: 3.1-3.5_

- [ ] 4. Studio (apps/web/src/reach/studio)
  - As design "Studio".
  - _Requirements: 4.1-4.4_
