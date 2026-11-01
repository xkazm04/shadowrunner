// Planes on the client (m0-spine requirement 4). The server names its plane in GET /api/health;
// `?plane=replay` forces replay for the visit. Until health answers, and whenever it cannot be
// read (no functions under `vite dev`, a network error), the client is on replay: the default
// plane needs no key and makes no paid call.
import { useSyncExternalStore } from "react";

export type Plane = "replay" | "live";
export type EngineState = "scripted" | "anthropic" | "offline";

/** Wire shape of GET /api/health. Mirrors `Health` in api/health.ts (the app may not import api/). */
export interface Health {
  plane: Plane;
  engine: EngineState;
  version: string;
}

export const HEALTH_URL = "/api/health";
export const DEFAULT_PLANE: Plane = "replay";

const PLANES: readonly string[] = ["replay", "live"] satisfies Plane[];
const ENGINES: readonly string[] = ["scripted", "anthropic", "offline"] satisfies EngineState[];

function isPlane(value: unknown): value is Plane {
  return typeof value === "string" && PLANES.includes(value);
}

function isEngineState(value: unknown): value is EngineState {
  return typeof value === "string" && ENGINES.includes(value);
}

/** `?plane=replay` (any case, any padding) forces replay. Nothing in the URL can force live. */
export function planeOverride(search: string): Plane | undefined {
  const values = new URLSearchParams(search).getAll("plane");
  return values.some((v) => v.trim().toLowerCase() === "replay") ? "replay" : undefined;
}

/** Validates a health body from the network; extra fields are dropped. */
export function parseHealth(value: unknown): Health | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const body: Partial<Record<keyof Health, unknown>> = value;
  const { plane, engine, version } = body;
  if (!isPlane(plane) || !isEngineState(engine) || typeof version !== "string") return undefined;
  return { plane, engine, version };
}

export function resolvePlane(override: Plane | undefined, health: Health | undefined): Plane {
  return override ?? health?.plane ?? DEFAULT_PLANE;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** One health read. Never throws: any failure is "no health", which means replay. */
export async function fetchHealth(fetcher: Fetcher): Promise<Health | undefined> {
  try {
    const res = await fetcher(HEALTH_URL, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return undefined;
    const body: unknown = await res.json();
    return parseHealth(body);
  } catch {
    return undefined;
  }
}

export interface PlaneStore {
  subscribe(onChange: () => void): () => void;
  health(): Health | undefined;
}

/** Holds the one health read. The load starts on the first subscribe, so a server render never fetches. */
export function createPlaneStore(load: () => Promise<Health | undefined>): PlaneStore {
  let current: Health | undefined;
  let started = false;
  const listeners = new Set<() => void>();
  return {
    subscribe(onChange) {
      listeners.add(onChange);
      if (!started) {
        started = true;
        load()
          .catch(() => undefined)
          .then((health) => {
            current = health;
            for (const listener of listeners) listener();
          });
      }
      return () => {
        listeners.delete(onChange);
      };
    },
    health: () => current,
  };
}

const browserStore = createPlaneStore(() => fetchHealth((url, init) => fetch(url, init)));

function browserPlane(): Plane {
  return resolvePlane(planeOverride(window.location.search), browserStore.health());
}

/** The plane this visit runs on. Without a window (tests, prerender) it is replay. */
export function usePlane(): Plane {
  return useSyncExternalStore(browserStore.subscribe, browserPlane, () => DEFAULT_PLANE);
}
