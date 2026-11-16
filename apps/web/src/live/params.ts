// /live's URL (spec flashhead-live, task 3): `/live` is the control page, `/live?out=1` the OBS
// view. `server` names the live server (default ws://127.0.0.1:8765/live); on the out view `corner`
// puts Iris in a corner while a slide shows (br, bl, tr, tl; default br) and `slides=0` hides
// slides. Pure, so it is table-tested.
import { serverUrl } from "./protocol";

export type Corner = "br" | "bl" | "tr" | "tl";
const CORNERS: readonly Corner[] = ["br", "bl", "tr", "tl"];

export interface LiveParams {
  out: boolean;
  server: string;
  corner: Corner;
  slides: boolean;
}

const yes = (value: string | null): boolean => value === "1" || value === "true";

export function parseLiveParams(search: string): LiveParams {
  const query = new URLSearchParams(search);
  const corner = query.get("corner")?.trim().toLowerCase();
  const slides = query.get("slides")?.trim().toLowerCase();
  return {
    out: yes(query.get("out")?.trim().toLowerCase() ?? null),
    server: serverUrl(search),
    corner: CORNERS.find((c) => c === corner) ?? "br",
    slides: !(slides === "0" || slides === "false"),
  };
}

/** True when the current URL asks for the OBS view (the shell renders it bare). Safe without a window. */
export function isOutView(): boolean {
  return typeof window !== "undefined" && parseLiveParams(window.location.search).out;
}

/** `<origin>/live?out=1` for this server (the server only when it is not the default). */
export function outUrl(origin: string, server: string, defaultServer: string): string {
  const query = new URLSearchParams({ out: "1" });
  if (server !== defaultServer) query.set("server", server);
  return `${origin.replace(/\/+$/, "")}/live?${query.toString()}`;
}

let counter = 0;
/** A message id unique to this page: `<prefix>-<base36 time>-<n>`. */
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}
