// /overlay (spec avatar-reach). Task 0 stub: the page lands in its own task.
import type { ReactElement } from "react";
import type { Plane } from "../../app/plane";

export default function OverlayPage({ plane }: { plane: Plane }): ReactElement {
  return <section data-page="overlay" data-plane={plane} aria-label="Overlay" />;
}
