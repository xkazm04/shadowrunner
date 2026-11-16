// /live (spec flashhead-live, task 3): live Iris on SoulX-FlashHead Lite, driven by the Python live
// server over `fhl/1`. `/live` is the control page (in the app's frame, like the studio);
// `/live?out=1` is the OBS browser source: the stream alone on a transparent page, no chrome.
import { useEffect, type ReactElement } from "react";
import type { Plane } from "../app/plane";
import { ControlPage } from "./ControlPage";
import { OutView } from "./OutView";
import { parseLiveParams } from "./params";

/** Paints `<html>` and `<body>` transparent while mounted (as the overlay does); restores them after. */
export function useTransparentPage(): void {
  useEffect(() => {
    const targets = [document.documentElement, document.body];
    const before = targets.map((el) => [el.style.getPropertyValue("background"), el.style.getPropertyPriority("background")] as const);
    for (const el of targets) el.style.setProperty("background", "transparent", "important");
    return () => {
      targets.forEach((el, i) => {
        const [value, priority] = before[i] ?? ["", ""];
        el.style.removeProperty("background");
        if (value !== "") el.style.setProperty("background", value, priority);
      });
    };
  }, []);
}

function OutPage({ server, corner, slides }: { server: string; corner: ReturnType<typeof parseLiveParams>["corner"]; slides: boolean }): ReactElement {
  useTransparentPage();
  return (
    <section data-page="live" data-out="1" aria-label="Iris, live">
      <OutView server={server} audio corner={corner} showSlides={slides} variant="page" />
    </section>
  );
}

export default function LivePage({ plane }: { plane: Plane }): ReactElement {
  const params = parseLiveParams(window.location.search);
  if (params.out) return <OutPage server={params.server} corner={params.corner} slides={params.slides} />;
  return (
    <div data-plane={plane}>
      <ControlPage server={params.server} />
    </div>
  );
}
