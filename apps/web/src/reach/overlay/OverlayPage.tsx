// /overlay (spec avatar-reach, design "Overlay"): an OBS browser source. With a source in the URL
// (`pack` or `character`) the character alone on the `bg` background (OverlayStage); without one,
// the setup card that builds that URL (OverlaySetup). The shell renders this page with no chrome.
import type { ReactElement } from "react";
import type { Plane } from "../../app/plane";
import { OverlaySetup } from "./OverlaySetup";
import { OverlayStage } from "./OverlayStage";
import { parseOverlayParams } from "./params";

export default function OverlayPage({ plane }: { plane: Plane }): ReactElement {
  const params = parseOverlayParams(window.location.search);
  if (params.source === undefined) return <OverlaySetup plane={plane} />;
  return (
    <section data-page="overlay" data-plane={plane} aria-label="Overlay">
      <OverlayStage source={params.source} params={params} />
    </section>
  );
}
