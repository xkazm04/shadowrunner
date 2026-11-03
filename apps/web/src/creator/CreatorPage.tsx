// CH 3 · Forge (costume 3.1, `r1/creator-b.html` "Anatomy Under Glass"): no tabs; the character
// is dressed on the face itself (glass/Anatomy). This page owns what outlives one character: the
// library and its cast strip (with "+ Forge new" to /creator/new), the replay gallery drawer, and
// the `?character=` deep link (CH 4's "Open in the Forge", and the rite's hand-off).
import type { Rig } from "@sr/rig";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PAGES } from "../app/pages";
import { handleLinkClick } from "../app/router";
import { Gallery } from "./gallery/Gallery";
import { loadCast, type GalleryEntry } from "./gallery/entries";
import { useHeaderSlot } from "../channels/headerSlot";
import { Anatomy } from "./glass/Anatomy";
import { ChannelActions } from "./glass/SignalCards";
import { Library, type LibraryOffer } from "./library/Library";
import { useLibrary, wantedCharacter } from "./library/useLibrary";
import styles from "./glass/Anatomy.module.css";
import signal from "./glass/Signal.module.css";
import bar from "./CastBar.module.css";

/** A character from the replay plane (a recorded forge or the gallery): labelled RECORDED. */
export const isRecorded = (rig: Rig): boolean =>
  rig.source === "replay" || rig.id.startsWith("replay-");

const forgeNew = PAGES.find((p) => p.id === "forge-new");

function ForgeNewSlot() {
  if (forgeNew === undefined) return null;
  return (
    <a
      href={forgeNew.path}
      className={styles.forgeSlot}
      onClick={(event) => handleLinkClick(event, forgeNew.path)}
    >
      + Forge new <kbd>{forgeNew.hotkey}</kbd>
    </a>
  );
}

/** The gallery over the page; Esc closes it (and is kept from the shell, which would leave). */
function Drawer({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  return (
    <div
      className={styles.drawer}
      role="dialog"
      aria-label="Replay gallery"
      onKeyDown={onKeyDown}
    >
      <div className={styles.drawerBox}>{children}</div>
    </div>
  );
}

export function CreatorPage() {
  // `/creator?character=<slug or id>` puts that character on the glass.
  const [want] = useState(() =>
    typeof window === "undefined"
      ? undefined
      : wantedCharacter(window.location.search),
  );
  const library = useLibrary(want === undefined ? {} : { want });
  // The link has done its work once the library has read it: drop it from the address, so a later
  // visit (or the router carrying the query to another channel) does not pull that character back.
  useEffect(() => {
    if (want === undefined || library.status === "loading") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("character");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [want, library.status]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  // Every gallery character, so the ones not kept yet (the cast-forge eight) sit in the strip too.
  const [castEntries, setCastEntries] = useState<readonly GalleryEntry[]>([]);
  useEffect(() => {
    let live = true;
    loadCast().then(
      (list) => live && setCastEntries(list),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  const slot = useHeaderSlot();

  const inLibrary = new Set(
    library.entries.flatMap((e) => (e.kind === "ok" ? [e.record.id] : [])),
  );
  const adopt = async (entry: GalleryEntry): Promise<void> => {
    await library.add(await entry.load());
    setGalleryOpen(false);
  };
  const show = (id: string): void => {
    setGalleryOpen(false);
    library.select(id);
  };
  const gallery = (
    <Gallery
      inLibrary={inLibrary}
      onAdopt={adopt}
      onShow={show}
      onClose={() => setGalleryOpen(false)}
    />
  );

  const offers: LibraryOffer[] =
    library.status === "loading"
      ? []
      : castEntries
          .filter((e) => !inLibrary.has(e.id))
          .map((e) => ({
            id: e.id,
            name: e.name,
            ...(e.portraitUrl === undefined
              ? {}
              : { portraitUrl: e.portraitUrl }),
            adopt: () => adopt(e),
          }));
  const active = library.active;
  const strip = (
    <div className={slot === null ? styles.cast : bar.castBar}>
      <Library
        entries={library.entries}
        {...(active === undefined ? {} : { activeId: active.id })}
        persistent={library.persistent}
        status={library.status}
        onSelect={(id) => {
          setGalleryOpen(false);
          library.select(id);
        }}
        onRemove={library.remove}
        onOpenGallery={() => setGalleryOpen(true)}
        extra={<ForgeNewSlot />}
        offers={offers}
        variant={slot === null ? "reel" : "bar"}
      />
    </div>
  );
  // In the frame's bar when it offers its slot (the breadcrumb gone), else under the glass.
  const cast = slot === null ? strip : undefined;
  const barStrip = slot === null ? null : createPortal(strip, slot);
  const drawer = galleryOpen ? (
    <Drawer onClose={() => setGalleryOpen(false)}>{gallery}</Drawer>
  ) : undefined;

  // Loading, or nothing to put on the glass (an empty or unreadable library): the regions stay,
  // each with its designed state, and the gallery is right there.
  if (active === undefined) {
    const loading = library.status === "loading";
    return (
      <div
        className={styles.anatomy}
        data-page="creator"
        data-state={loading ? "loading" : "empty"}
      >
        <aside className={styles.rail} aria-label="Layer stack">
          <h2 className={styles.cardTitle}>LAYER STACK</h2>
        </aside>
        <section className={styles.centre} aria-label="The glass">
          <div className={styles.glassBox}>
            <p className={styles.empty}>
              {loading
                ? "Opening the library…"
                : "No character under the glass yet. Adopt one from the gallery, or forge one."}
            </p>
          </div>
          {cast}
        </section>
        {barStrip}
        <aside className={signal.signal} aria-label="Signal">
          {!loading && <div className={styles.drawerBox}>{gallery}</div>}
          <ChannelActions />
        </aside>
      </div>
    );
  }
  return (
    <>
      <Anatomy
        key={`${active.id}@${active.createdAt}`}
        record={active}
        library={library}
        {...(cast === undefined ? {} : { cast })}
        {...(isRecorded(active.rig)
          ? { badge: <span className={styles.recorded}>RECORDED</span> }
          : {})}
      />
      {drawer}
      {barStrip}
    </>
  );
}
