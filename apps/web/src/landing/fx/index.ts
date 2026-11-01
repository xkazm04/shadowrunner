// The landing's effects, one lazy chunk (landing requirement 9.5): imported only with
// `import("./fx")`, and only when the shell says `data-motion="full"`. Nothing imports this
// module statically, so a reduced-motion visit never downloads it.
export { startDust } from "./dust";
export { startFlicker } from "./flicker";
export { playChat } from "./typing";
