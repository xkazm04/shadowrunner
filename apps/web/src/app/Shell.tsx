// App shell: everything outside a page. The router, the keymap and the navigation all derive
// from the page manifest (pages.ts). Channels behind the set open in the ChannelFrame (spec
// landing task 9): CH 3 the creator (lazy chunk), CH 4 the listings, CH 6 the daemon, a "sealed"
// page the sealed door; a page whose spec has not landed yet is a placeholder in the same frame.
// The frame's bar carries the channel strip (costume 1.3); Forge new (/creator/new) is framed too.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { buildKeymap, GLOBAL_BINDINGS, stepChannel, useHotkeys, type KeyAction } from "./keys";
import { ChannelFrame } from "../channels/ChannelFrame";
import { Daemon } from "../channels/Daemon";
import { Listings } from "../channels/Listings";
import { Sealed } from "../channels/Sealed";
import { LandingPage } from "../landing/LandingPage";
import { daemonOf } from "../landing/StatusBar";
import { channelPages, PAGES, type PageDef } from "./pages";
import { useHealth, usePlane, type Health, type Plane } from "./plane";
import { handleLinkClick, navigate, useRoute } from "./router";
import styles from "./Shell.module.css";
import { nextTheme, usePreferences, useTheme, type Motion, type ThemeName } from "./theme";

/** The on-air stage (voice-and-air 5.3), loaded on first visit to /air: the renderer stays off the set. */
const AirPage = lazy(() => import("../air/AirPage"));
/** CH 3, the creator (spec creator): its own chunk, so the set does not carry it. */
const CreatorPage = lazy(() => import("../creator/CreatorPage").then((m) => ({ default: m.CreatorPage })));
/** Forge new, the rite (costume 3.2): its own chunk too. */
const RitePage = lazy(() => import("../creator/rite/RitePage").then((m) => ({ default: m.RitePage })));

/** Built once at load: a manifest clash throws here, before anything renders. */
const KEYMAP = buildKeymap(PAGES);

const THEME_LABEL: Readonly<Record<ThemeName, string>> = { halloween: "Halloween", baseline: "Baseline" };

/** Channels in dial order, then the pages that are off the dial (the stage). */
const NAV_ORDER: readonly PageDef[] = [...channelPages(PAGES), ...PAGES.filter((p) => p.channel === undefined)];

const themeKey = GLOBAL_BINDINGS.find((b) => b.action.kind === "theme")?.hotkey;
const gotoKey = GLOBAL_BINDINGS.find((b) => b.action.kind === "goto")?.hotkey;

function pageLabel(page: PageDef): string {
  return page.channel === undefined ? page.title : `CH ${page.channel} · ${page.title}`;
}

function PageLink({ page, current, onGo }: { page: PageDef; current: boolean; onGo?: () => void }) {
  return (
    <a
      href={page.path}
      aria-current={current ? "page" : undefined}
      onClick={(event) => {
        handleLinkClick(event, page.path);
        onGo?.();
      }}
    >
      <kbd>{page.hotkey}</kbd> {pageLabel(page)}
    </a>
  );
}

function GoTo({ current, onClose }: { current: PageDef | undefined; onClose: () => void }) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    list.current?.querySelector("a")?.focus();
  }, []);
  return (
    <div role="dialog" aria-label="Go to" className={styles.goto}>
      <ul ref={list}>
        {NAV_ORDER.map((page) => (
          <li key={page.id}>
            <PageLink page={page} current={page.id === current?.id} onGo={onClose} />
          </li>
        ))}
      </ul>
      <button type="button" onClick={onClose}>
        Close <kbd>Esc</kbd>
      </button>
    </div>
  );
}

function Placeholder({ page }: { page: PageDef }) {
  return (
    <section data-page={page.id} aria-labelledby="page-title">
      <h1 id="page-title">{pageLabel(page)}</h1>
      {page.subtitle && <p>{page.subtitle}</p>}
      <p>No programme on this channel yet.</p>
    </section>
  );
}

function NoSignal({ path }: { path: string }) {
  return (
    <section data-page="none" aria-labelledby="page-title">
      <h1 id="page-title">No signal</h1>
      <p>{`Nothing is broadcast at ${path}.`}</p>
      <a href="/" onClick={(event) => handleLinkClick(event, "/")}>
        Back to the set
      </a>
    </section>
  );
}

/** A page's programme: the sealed door, the listings, the daemon, or a placeholder. */
function ChannelBody({ page, plane, health, lost }: { page: PageDef; plane: Plane; health?: Health; lost: boolean }) {
  if (page.status === "sealed") return <Sealed page={page} />;
  if (page.id === "characters") return <Listings />;
  if (page.id === "creator") {
    return (
      <Suspense fallback={<p data-page="creator">Opening the forge…</p>}>
        <CreatorPage />
      </Suspense>
    );
  }
  if (page.id === "daemon") return <Daemon health={health} plane={plane} lost={lost} />;
  if (page.id === "forge-new") {
    // Costume task 3.2: the rite page (creator lane).
    return (
      <Suspense fallback={<p data-page="forge-new">Opening the forge…</p>}>
        <RitePage />
      </Suspense>
    );
  }
  return <Placeholder page={page} />;
}

/**
 * Rendered by the shell, so no page can forget it (requirement 4.2): in the shell header, or on
 * the set handed to the landing's status bar, which is the header there (spec landing task 4).
 */
function RecordedBadge() {
  return (
    <p className={styles.recorded} data-badge="recorded" title="Replay plane: recorded answers, no live calls">
      RECORDED
    </p>
  );
}

export interface ShellViewProps {
  path: string;
  page: PageDef | undefined;
  plane: Plane;
  theme: ThemeName;
  motion: Motion;
  gotoOpen: boolean;
  /** The replay-only daemon sample (key D): the set plays the daemon-lost state. */
  daemonSample?: boolean;
  /** The one health read (usePlane resolves from the same request); undefined until it answers. */
  health?: Health;
  onToggleTheme: () => void;
  onCloseGoto: () => void;
}

/** A half-filled disc: two themes, one switch. Drawn in currentColor. */
function ThemeIcon() {
  return (
    <svg className={styles.toggleIcon} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path d="M10 2.5a7.5 7.5 0 0 1 0 15z" fill="currentColor" />
    </svg>
  );
}

function ThemeToggle({ theme, onToggle, icon = false }: { theme: ThemeName; onToggle: () => void; icon?: boolean }) {
  const next = nextTheme(theme);
  const label = `Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[next]}`;
  return (
    <button
      type="button"
      className={icon ? `${styles.toggle} ${styles.iconToggle}` : styles.toggle}
      onClick={onToggle}
      aria-label={label}
      title={icon ? label : undefined}
      data-toggle="theme"
    >
      {icon ? <ThemeIcon /> : `Theme: ${THEME_LABEL[theme]} `}
      {themeKey && <kbd>{themeKey}</kbd>}
    </button>
  );
}

/** Pure render of the shell for a given route and settings (rendered directly by tests). */
export function ShellView({
  path,
  page,
  plane,
  theme,
  motion,
  gotoOpen,
  daemonSample = false,
  health,
  onToggleTheme,
  onCloseGoto,
}: ShellViewProps) {
  const onSet = page?.id === "landing";
  // The stage is full screen like the set (a stream's browser source): no shell header.
  const onStage = page?.id === "air";
  // Every page behind the set (the channels and Forge new, costume 1.2): its frame is the header
  // (channel strip, breadcrumb, badge, toggle).
  const framed = !onSet && !onStage && page !== undefined;
  const sample = plane === "replay" && daemonSample;
  const lost = daemonOf(health) === "lost" || sample;
  const badge = plane === "replay" && <RecordedBadge />;
  // On the set the toggle is an icon button in the status bar (spec landing task 5.0).
  const toggle = <ThemeToggle theme={theme} onToggle={onToggleTheme} icon={onSet || onStage} />;
  return (
    <div
      data-shell
      data-motion={motion}
      data-plane={plane}
      className={onSet || onStage ? `${styles.shell} ${styles.onSet}` : styles.shell}
    >
      {/* On the set the landing's status bar is the header; the shell hands it the badge and toggle. */}
      {!onSet && !onStage && !framed && (
        <header className={styles.header}>
          <a href="/" className={styles.brand} onClick={(event) => handleLinkClick(event, "/")}>
            Shadowrunner
          </a>
          {badge}
          <nav aria-label="Channels" className={styles.nav}>
            <ul>
              {NAV_ORDER.map((p) => (
                <li key={p.id}>
                  <PageLink page={p} current={p.id === page?.id} />
                </li>
              ))}
            </ul>
          </nav>
          {toggle}
          {gotoKey && (
            <span>
              Go to <kbd>{gotoKey}</kbd>
            </span>
          )}
        </header>
      )}
      {gotoOpen && <GoTo current={page} onClose={onCloseGoto} />}
      <main className={onSet || onStage ? styles.set : framed ? styles.channel : styles.main}>
        {page === undefined ? (
          <NoSignal path={path} />
        ) : onStage ? (
          // COSTUME HOOK (air lane, costume task 6): the stage carries the strip as
          // <ChannelStrip variant="stage" current={page.id} daemonLost={lost} open={…} /> (./ChannelStrip),
          // hidden for capture; hand it to AirPage here (e.g. a `strip` prop) and bind C / Esc to `open`.
          <Suspense fallback={<section data-page="air" aria-label={page.title}>{badge}</section>}>
            <AirPage plane={plane} badge={badge} controls={toggle} />
          </Suspense>
        ) : onSet ? (
          <LandingPage plane={plane} badge={badge} controls={toggle} daemonSample={sample} />
        ) : (
          <ChannelFrame page={page} badge={badge} controls={toggle} daemonLost={lost}>
            <ChannelBody page={page} plane={plane} health={health} lost={lost} />
          </ChannelFrame>
        )}
      </main>
    </div>
  );
}

export function Shell() {
  const { path, page } = useRoute(PAGES);
  const plane = usePlane();
  const health = useHealth();
  const [theme, toggleTheme] = useTheme();
  const { motion } = usePreferences();
  const [gotoOpen, setGotoOpen] = useState(false);
  const [daemonSample, setDaemonSample] = useState(false);
  const closeGoto = useCallback(() => setGotoOpen(false), []);

  useEffect(() => {
    document.title = page ? `${page.title} · Shadowrunner` : "No signal · Shadowrunner";
  }, [page]);

  const onAction = useCallback(
    (action: KeyAction): boolean => {
      switch (action.kind) {
        case "go": {
          const target = PAGES.find((p) => p.id === action.pageId);
          if (target) navigate(target.path);
          setGotoOpen(false);
          return true;
        }
        case "channel": {
          const target = stepChannel(PAGES, page?.id, action.step);
          if (!target) return false;
          navigate(target.path);
          return true;
        }
        case "back":
          if (gotoOpen) setGotoOpen(false);
          else navigate("/");
          return true;
        case "goto":
          setGotoOpen((open) => !open);
          return true;
        case "theme":
          toggleTheme();
          return true;
        case "daemon-sample":
          // A sample of the daemon-lost state, on replay only (landing requirement 2.5). On live
          // the key is not ours: the daemon's state is the real one.
          if (plane !== "replay") return false;
          setDaemonSample((on) => !on);
          return true;
      }
    },
    [page, plane, gotoOpen, toggleTheme],
  );
  useHotkeys(KEYMAP, onAction);

  return (
    <ShellView
      path={path}
      page={page}
      plane={plane}
      theme={theme}
      motion={motion}
      gotoOpen={gotoOpen}
      daemonSample={daemonSample}
      health={health}
      onToggleTheme={toggleTheme}
      onCloseGoto={closeGoto}
    />
  );
}
