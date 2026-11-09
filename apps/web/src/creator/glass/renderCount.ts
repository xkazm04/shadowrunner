// Test-only (perfection-pass task 9): counts which function components React rendered, by name, for
// the render-count tests. Never imported by app code, so never bundled.
// It stands in for the React DevTools hook (`__REACT_DEVTOOLS_GLOBAL_HOOK__`), which react-dom reads
// once when it loads, so a test imports this module before anything that imports react-dom. On
// every commit it walks only the part of the tree that was rendered (a fiber whose child is the
// same object as its alternate's was not entered) and counts each function or memo component whose
// PerformedWork flag is set, i.e. whose function ran (a memo bailout does not set it).
// Fiber tags and the flag are React internals (stable since React 16; checked against React 19.3).

interface Fiber {
  tag: number;
  flags: number;
  type: unknown;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
}

const PERFORMED_WORK = 1;
/** FunctionComponent, ClassComponent, ForwardRef, SimpleMemoComponent (a MemoComponent's inner fiber is a FunctionComponent). */
const COUNTED = new Set([0, 1, 11, 15]);

const counts = new Map<string, number>();

function nameOf(fiber: Fiber): string | undefined {
  const type = fiber.type;
  if (typeof type === "function") return (type as { displayName?: string }).displayName ?? type.name;
  if (typeof type === "object" && type !== null) {
    const inner = (type as { render?: unknown; type?: unknown }).render ?? (type as { type?: unknown }).type;
    if (typeof inner === "function") return inner.name;
  }
  return undefined;
}

function tally(fiber: Fiber): void {
  if (!COUNTED.has(fiber.tag)) return;
  const name = nameOf(fiber);
  if (name !== undefined && name !== "") counts.set(name, (counts.get(name) ?? 0) + 1);
}

function mounted(fiber: Fiber | null): void {
  for (let f = fiber; f !== null; f = f.sibling) {
    tally(f);
    mounted(f.child);
  }
}

function updated(next: Fiber, prev: Fiber): void {
  if ((next.flags & PERFORMED_WORK) !== 0) tally(next);
  if (next.child === prev.child) return;
  for (let f = next.child; f !== null; f = f.sibling) {
    if (f.alternate === null) {
      tally(f);
      mounted(f.child);
    } else updated(f, f.alternate);
  }
}

function onCommitFiberRoot(_renderer: number, root: { current: Fiber }): void {
  const next = root.current;
  if (next.alternate === null) mounted(next.child);
  else updated(next, next.alternate);
}

Reflect.set(globalThis, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
  supportsFiber: true,
  renderers: new Map(),
  inject: () => 1,
  onCommitFiberRoot,
  onCommitFiberUnmount: () => undefined,
  onPostCommitFiberRoot: () => undefined,
});

/** Forgets every count. */
export function resetRenders(): void {
  counts.clear();
}

/** How many times each named component rendered since the last reset. */
export function renders(): Readonly<Record<string, number>> {
  return Object.fromEntries(counts);
}
