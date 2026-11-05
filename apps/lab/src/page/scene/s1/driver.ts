// S1's wiring, free of the DOM so it is unit-tested with a canvas mock: scene events and spoken
// lines go into the model, each frame samples it once, and that one frame feeds both the live view
// and the recorded painters.
import type { SceneDriver } from "../../../contract.js";
import type { SceneContext } from "../../types.js";
import { SceneModel, type SceneFrame } from "./model.js";
import { paintBack, paintFront, type Canvas2D } from "./paint.js";
import type { Palette } from "./palette.js";
import type { S1View } from "./view.js";

const ATTACK = 0.5;
const RELEASE = 0.08;

export interface S1Driver extends SceneDriver {
  /** The frame the painters draw next (tests and diagnostics). */
  frame(): SceneFrame;
  readonly model: SceneModel;
  /** The painters handed to `addPainter` (typed on the narrow Canvas2D the page's context satisfies). */
  readonly painters: Readonly<Record<"back" | "front", (g: Canvas2D, nowMs: number) => void>>;
}

export function createS1Driver(ctx: SceneContext, palette: Palette, view?: S1View): S1Driver {
  const model = new SceneModel(ctx.reducedMotion);
  let speech = 0;
  let current = model.sample(ctx.audio.nowMs());
  ctx.onFrame((nowMs) => {
    const level = ctx.audio.level();
    speech += (level - speech) * (level > speech ? ATTACK : RELEASE);
    current = model.sample(nowMs, speech);
    view?.update(current);
  });
  ctx.onUtterance((line) => model.utter(line));
  const painters = {
    back: (g: Canvas2D) => paintBack(g, current, palette),
    front: (g: Canvas2D) => paintFront(g, current, palette),
  };
  ctx.addPainter("back", painters.back);
  ctx.addPainter("front", painters.front);
  return {
    id: "S1",
    model,
    painters,
    frame: () => current,
    apply(event) {
      model.apply(event, ctx.audio.nowMs());
    },
    dispose() {
      view?.dispose();
    },
  };
}
