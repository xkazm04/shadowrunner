// Planes on the client (m0-spine requirement 4). The server names its plane in GET /api/health;
// `?plane=replay` forces replay for the visit. Until health answers, and whenever it cannot be
// read (no functions under `vite dev`, a network error), the client is on replay: the default
// plane needs no key and makes no paid call. While the override is active, every /api/* request
// carries `x-sr-plane: replay` so paid endpoints serve replay too (steering tech.md).
// The wire types and their validator live in @sr/engine; the re-export is for the shell.
import { PLANE_HEADER, parseHealth, type Health, type Plane } from "@sr/engine";
import { useSyncExternalStore } from "react";

export type { EngineState, Health, Plane } from "@sr/engine";

export const HEALTH_URL = "/api/health";
export const DEFAULT_PLANE: Plane = "replay";

/** `?plane=replay` (any case, any padding) forces replay. Nothing in the URL can force live. */
export function planeOverride(search: string): Plane | undefined {
  const values = new URLSearchParams(search).getAll("plane");
  return values.some((v) => v.trim().toLowerCase() === "replay") ? "replay" : undefined;
}

export function resolvePlane(override: Plane | undefined, health: Health | undefined): Plane {
  return override ?? health?.plane ?? DEFAULT_PLANE;
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Same-origin API paths (`/api/...`). Absolute and protocol-relative URLs are not ours to tag. */
export function isApiPath(url: string): boolean {
  return url.startsWith("/api/");
}

/**
 * Wraps a fetcher so every /api/* request carries `x-sr-plane: replay` while the `?plane=replay`
 * override is active. `search` is read per request, so the header follows the current URL.
 * The header is set over any value the caller passed; other requests pass through untouched.
 */
export function withPlaneHeader(fetcher: Fetcher, search: () => string): Fetcher {
  return (url, init) => {
    if (!isApiPath(url) || planeOverride(search()) !== "replay") return fetcher(url, init);
    const headers = new Headers(init?.headers);
    headers.set(PLANE_HEADER, "replay");
    return fetcher(url, { ...init, headers });
  };
}

/** The browser's fetch for /api/*: every client call to a function goes through this. */
export const apiFetch: Fetcher = withPlaneHeader(
  (url, init) => fetch(url, init),
  () => window.location.search,
);

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

const browserStore = createPlaneStore(() => fetchHealth(apiFetch));

function browserPlane(): Plane {
  return resolvePlane(planeOverride(window.location.search), browserStore.health());
}

/** The plane this visit runs on. Without a window (tests, prerender) it is replay. */
export function usePlane(): Plane {
  return useSyncExternalStore(browserStore.subscribe, browserPlane, () => DEFAULT_PLANE);
}
