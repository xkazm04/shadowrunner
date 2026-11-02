// Counting WebGL2 / canvas2D stubs (avatar-renderer task 3.1): no GPU under vitest. Every GL call is
// recorded by name; `create*` returns a fresh handle tracked in `live` until its `delete*`, so tests
// can count draws and uploads per frame and prove that `dispose` frees everything.
import type { CanvasHost } from "../render/types.js";

export interface GlStub {
  gl: WebGL2RenderingContext;
  /** Calls per GL method name. */
  counts: Map<string, number>;
  /** GL objects created and not yet deleted. */
  live: Set<object>;
  /** Every call in order: method name and arguments. */
  log: Array<[name: string, args: unknown[]]>;
  count(name: string): number;
  reset(): void;
  /** Makes `isContextLost()` true. */
  lose(): void;
}

const CREATE = ["createTexture", "createBuffer", "createFramebuffer", "createProgram", "createShader", "createVertexArray", "createRenderbuffer"];
const DELETE = ["deleteTexture", "deleteBuffer", "deleteFramebuffer", "deleteProgram", "deleteShader", "deleteVertexArray", "deleteRenderbuffer"];

/** A stand-in for a DOM type the stub cannot construct; only the members the code uses exist. */
const stand = <T extends object>(value: object): T => value as T;

/** A GLenum per constant name, stable within one stub. */
function constants(): (name: string) => number {
  const ids = new Map<string, number>();
  return (name) => {
    let id = ids.get(name);
    if (id === undefined) {
      id = 0x1000 + ids.size;
      ids.set(name, id);
    }
    return id;
  };
}

export function createGlStub(): GlStub {
  const counts = new Map<string, number>();
  const live = new Set<object>();
  const log: Array<[string, unknown[]]> = [];
  const enumOf = constants();
  let lost = false;
  const bump = (name: string): void => {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  };
  const special: Record<string, (...args: unknown[]) => unknown> = {
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getShaderInfoLog: () => "",
    getProgramInfoLog: () => "",
    getUniformLocation: (_p, name) => ({ uniform: name }),
    getAttribLocation: () => 0,
    checkFramebufferStatus: () => enumOf("FRAMEBUFFER_COMPLETE"),
    isContextLost: () => lost,
    getExtension: () => null,
    getError: () => enumOf("NO_ERROR"),
  };
  for (const name of CREATE) special[name] = () => {
    const handle = { kind: name.slice("create".length) };
    live.add(handle);
    return handle;
  };
  for (const name of DELETE) special[name] = (handle) => {
    if (typeof handle === "object" && handle !== null) live.delete(handle);
  };
  const target: object = {};
  const gl = new Proxy(target, {
    get(_t, prop) {
      if (typeof prop !== "string") return undefined;
      if (/^[A-Z][A-Z0-9_]*$/.test(prop)) return enumOf(prop);
      const fn = special[prop];
      return (...args: unknown[]) => {
        bump(prop);
        log.push([prop, args]);
        return fn === undefined ? undefined : fn(...args);
      };
    },
  });
  return {
    gl: stand<WebGL2RenderingContext>(gl),
    counts,
    live,
    log,
    count: (name) => counts.get(name) ?? 0,
    reset: () => {
      counts.clear();
      log.length = 0;
    },
    lose: () => {
      lost = true;
    },
  };
}

export interface Ctx2dStub {
  ctx: CanvasRenderingContext2D;
  counts: Map<string, number>;
  count(name: string): number;
  /** Arguments of every `setTransform` call. */
  transforms: number[][];
  /** `globalAlpha` at each `drawImage`. */
  alphas: number[];
  /** `filter` at each `drawImage` ("none" when never set). */
  filters: string[];
}

export function createCtx2dStub(): Ctx2dStub {
  const counts = new Map<string, number>();
  const transforms: number[][] = [];
  const alphas: number[] = [];
  const filters: string[] = [];
  const props: Record<string | symbol, unknown> = { globalAlpha: 1 };
  const target: object = {};
  const ctx = new Proxy(target, {
    get(_t, prop) {
      if (prop in props) return props[prop];
      if (typeof prop !== "string") return undefined;
      return (...args: unknown[]) => {
        counts.set(prop, (counts.get(prop) ?? 0) + 1);
        if (prop === "setTransform") transforms.push(args.map(Number));
        if (prop === "drawImage") alphas.push(Number(props.globalAlpha));
        if (prop === "drawImage") filters.push(typeof props.filter === "string" ? props.filter : "none");
      };
    },
    set(_t, prop, value) {
      props[prop] = value;
      return true;
    },
  });
  return { ctx: stand<CanvasRenderingContext2D>(ctx), counts, count: (name) => counts.get(name) ?? 0, transforms, alphas, filters };
}

export interface CanvasStub {
  canvas: CanvasHost;
  /** Fires `webglcontextlost` at the registered listeners. */
  loseContext(): void;
  listeners(): number;
}

export interface CanvasStubOptions {
  /** What `getContext("webgl2")` does. */
  webgl2: GlStub | "null" | "throw";
  /** What `getContext("2d")` returns; null by default. */
  ctx2d?: Ctx2dStub;
  width?: number;
  height?: number;
}

export function createCanvasStub(options: CanvasStubOptions): CanvasStub {
  const lostListeners = new Set<(event: Event) => void>();
  function getContext(contextId: "webgl2", o?: WebGLContextAttributes): WebGL2RenderingContext | null;
  function getContext(contextId: "2d", o?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null;
  function getContext(contextId: string): WebGL2RenderingContext | CanvasRenderingContext2D | null {
    if (contextId === "2d") return options.ctx2d?.ctx ?? null;
    if (options.webgl2 === "throw") throw new Error("webgl2 unavailable");
    return options.webgl2 === "null" ? null : options.webgl2.gl;
  }
  const canvas: CanvasHost = {
    width: options.width ?? 300,
    height: options.height ?? 150,
    getContext,
    addEventListener: (_type, listener) => {
      lostListeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      lostListeners.delete(listener);
    },
  };
  return {
    canvas,
    loseContext: () => {
      const event = stand<Event>({ type: "webglcontextlost", preventDefault: () => undefined });
      for (const listener of lostListeners) listener(event);
    },
    listeners: () => lostListeners.size,
  };
}
