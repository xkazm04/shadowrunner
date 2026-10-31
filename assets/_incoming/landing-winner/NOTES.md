# The Harvest Floor

## Philosophy
The set is the last thing harvested: it stands on the cellar floor among the gourds, and the gourds are the remote.

The show is already on, in an empty cellar at three in the morning: the landing is the broadcast itself, and the creator is the back panel of the set. The first frame is Arch-Lich Malakor live on a walnut television, his real 18-layer rig in a phosphor tube, answering a chat only you read. The channel knob is the navigation: 2 On air, 3 Forge, 4 Characters, 6 Daemon, 9 Sealed.

## How it stays readable at scale
One 1600x900 world scales as a unit. Below a 0.78 aspect ratio it becomes a 420x910 portrait, stacked as header, set, gourds, then chat. Text is real HTML at 16 px or larger, set on opaque paper or near-black floor shadow. No photo sits behind body text. Hovering a gourd writes its channel across the glass. Deep links: `#ch=3`, `#forge`, `#ch=4`, `#daemon=lost`.

## The wow moment
The room's light is the menu. The gourd for your channel burns, the others hold an ember, and changing channel moves the candle along the row. Press D: the picture folds to a dot, and the spiral pumpkin and each gourd go out one by one. Their carved numbers stay readable as cold cuts. Only the eye on the right-hand pile keeps burning, and its pupil now holds you with no lag.

## Known limits
- **Dropped on purpose:**
  - The middle column, including its headline and calls to action. The channels are the calls to action.
  - The drawn canvas gourds and SVG cobwebs, because the photos carry the rot and the webs.
  - The knob label.
- The set's base is cut off by the edge of its photo, so it fades into floor shadow.
- The stills are JPEG copies in `img/`. The `data/` PNGs are untouched. All imagery is stylised; the chat and the forge are simulated.

## Round 4
- **Composition:** `root-cellar-wide` fills the frame. The frontal set stands centred on its floor, its glass 552 px wide. The chat is a paper strip tacked under a rafter. The lit spiral pumpkin from `root-pile` sits in the left foreground and throws dots onto the wall.
- **TV:** this variant uses `crt-frontal`. Its glass is measured as a superellipse, |x/253|³+|y/204|³=1, centred at (597,427). The picture is clipped to that shape. The same shape masks the photo's own glare, a rim shadow and the lower third, which carries the story line.
- **Menu:** five gourds cut from `root-pile`, each with its channel number carved through.
- **Stats:** the header row holds ON AIR, viewers, the channel, and "live since" with a running clock that becomes "dead air for" when the daemon is lost.
- **Weight:** about 1.7 MB on first load, plus 0.08 MB lazy-loaded.
