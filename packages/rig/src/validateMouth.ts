// Rig.mouth (llm-avatar-lab) and its lips (art-mouth): the shape read of an undecoded `mouth` and its
// contract-order wire. Absent is fine. Present, it is `bad_shape` at `<path>` unless an object and at
// `<path>.<field>` unless cx in [0, width], lineY in [0, height] and width finite > 0; `render`
// ("drawn" | "still") and `cell` (finite > 0) optional. `lips` is optional; present, it is `bad_shape`
// at `<path>.lips` unless an object of finite `left`, `right`, `upper`, `lower` with
// 0 <= left < cx < right <= width and 0 <= upper < lineY < lower <= height; its optional `seam` is finite
// with upper <= seam <= lower, else `bad_shape` at `<path>.lips.seam`; `maw` is `true` or omitted.
import { got, isFiniteNumber, isRecord, Reader, sectionRead, type Guard, type SectionRead } from "./read.js";
import type { RigLips, RigMouth } from "./types.js";
import type { MotionCanvas } from "./validateMotion.js";

class MouthReader extends Reader {
  mouth(value: unknown, path: string, canvas: MotionCanvas): RigMouth | undefined {
    if (!isRecord(value)) return this.fail(path, `when present, ${got(value, "an object { cx, lineY, width }")}`);
    const within =
      (limit: number | undefined): Guard<number> =>
      (v: unknown): v is number =>
        isFiniteNumber(v) && v >= 0 && (limit === undefined || v <= limit);
    const cx = this.required(value, "cx", path, within(canvas.width), `a number in [0, ${canvas.width ?? "width"}]`);
    const lineY = this.required(value, "lineY", path, within(canvas.height), `a number in [0, ${canvas.height ?? "height"}]`);
    const width = this.required(value, "width", path, (v: unknown): v is number => isFiniteNumber(v) && v > 0, "a finite number > 0");
    const render = value.render;
    if (render !== undefined && render !== "drawn" && render !== "still") return this.fail(`${path}.render`, `when present, ${got(render, '"drawn" or "still"')}`);
    const cell = value.cell;
    if (cell !== undefined && !(isFiniteNumber(cell) && cell > 0)) return this.fail(`${path}.cell`, `when present, ${got(cell, "a finite number > 0")}`);
    if (cx === undefined || lineY === undefined || width === undefined) return undefined;
    const lips = value.lips === undefined ? undefined : this.lips(value.lips, `${path}.lips`, cx, lineY, canvas);
    if (value.lips !== undefined && lips === undefined) return undefined;
    return { cx, lineY, width, ...(render === undefined ? {} : { render }), ...(typeof cell === "number" ? { cell } : {}), ...(lips === undefined ? {} : { lips }) };
  }

  /** Rig.mouth.lips (art-mouth): finite corners either side of cx, upper above and lower below lineY, on the canvas. */
  lips(value: unknown, path: string, cx: number, lineY: number, canvas: MotionCanvas): RigLips | undefined {
    const expected = `an object { left, right, upper, lower } with 0 <= left < cx < right <= ${canvas.width ?? "width"} and 0 <= upper < lineY < lower <= ${canvas.height ?? "height"}`;
    if (!isRecord(value)) return this.fail(path, `when present, ${got(value, expected)}`);
    const { left, right, upper, lower } = value;
    if (!isFiniteNumber(left) || !isFiniteNumber(right) || !isFiniteNumber(upper) || !isFiniteNumber(lower)) return this.fail(path, `${expected}; a field is not a finite number`);
    const [w, h] = [canvas.width ?? Infinity, canvas.height ?? Infinity];
    if (!(left >= 0 && left < cx && cx < right && right <= w)) return this.fail(path, `${expected}; got left ${left}, cx ${cx}, right ${right}`);
    if (!(upper >= 0 && upper < lineY && lineY < lower && lower <= h)) return this.fail(path, `${expected}; got upper ${upper}, lineY ${lineY}, lower ${lower}`);
    const seam = value.seam;
    if (seam !== undefined && !(isFiniteNumber(seam) && seam >= upper && seam <= lower)) return this.fail(`${path}.seam`, `when present, ${got(seam, `a finite number in [upper ${upper}, lower ${lower}]`)}`);
    if (value.maw !== undefined && value.maw !== true) return this.fail(`${path}.maw`, `when present, ${got(value.maw, "true")}`);
    return { left, right, upper, lower, ...(seam === undefined ? {} : { seam }), ...(value.maw === true ? { maw: true as const } : {}) };
  }
}

/** `Rig.mouth` at `path`; absent is fine. A canvas dimension that is unknown bounds nothing. */
export function readMouth(value: unknown, path: string, canvas: MotionCanvas = {}): SectionRead<RigMouth> {
  if (value === undefined) return { problems: [] };
  const reader = new MouthReader();
  return sectionRead(reader.mouth(value, path, canvas), reader.problems);
}

/** `Rig.mouth` in contract order. */
export function wireMouth(mouth: RigMouth): RigMouth {
  const { lips } = mouth;
  return {
    cx: mouth.cx,
    lineY: mouth.lineY,
    width: mouth.width,
    ...(mouth.render === undefined ? {} : { render: mouth.render }),
    ...(mouth.cell === undefined ? {} : { cell: mouth.cell }),
    ...(lips === undefined ? {} : { lips: { left: lips.left, right: lips.right, upper: lips.upper, lower: lips.lower, ...(lips.seam === undefined ? {} : { seam: lips.seam }), ...(lips.maw === true ? { maw: true as const } : {}) } }),
  };
}
