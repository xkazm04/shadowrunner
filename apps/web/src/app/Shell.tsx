// App shell: everything outside a page. The router, the keymap and the navigation all derive
// from the page manifest (pages.ts). Pages are placeholders until their specs land; a page with
// status "sealed" renders the sealed door and its line of lore instead.
import { useCallback, useEffect, useRef, useState } from "react";
import { buildKeymap, GLOBAL_BINDINGS, stepChannel, useHotkeys, type KeyAction } from "./keys";
import { LandingPage } from "../landing/LandingPage";
import { channelPages, PAGES, type PageDef } from "./pages";
import { usePlane, type Plane } from "./plane";
import { handleLinkClick, navigate, useRoute } from "./router";
import styles from "./Shell.module.css";
import { nextTheme, usePreferences, useTheme, type Motion, type ThemeName } from "./theme";

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

function SealedDoor({ page }: { page: PageDef }) {
  return (
    <section data-door="sealed" aria-labelledby="page-title">
      <h1 id="page-title">{pageLabel(page)}</h1>
      <p>{page.lore}</p>
    </section>
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
  onToggleTheme: () => void;
  onCloseGoto: () => void;
}

function ThemeToggle({ theme, onToggle }: { theme: ThemeName; onToggle: () => void }) {
  const next = nextTheme(theme);
  return (
    <button
      type="button"
      className={styles.toggle}
      onClick={onToggle}
      aria-label={`Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[next]}`}
    >
      Theme: {THEME_LABEL[theme]} {themeKey && <kbd>{themeKey}</kbd>}
    </button>
  );
}

/** Pure render of the shell for a given route and settings (rendered directly by tests). */
export function ShellView({ path, page, plane, theme, motion, gotoOpen, onToggleTheme, onCloseGoto }: ShellViewProps) {
  const onSet = page?.id === "landing";
  const badge = plane === "replay" && <RecordedBadge />;
  const toggle = <ThemeToggle theme={theme} onToggle={onToggleTheme} />;
  return (
    <div
      data-shell
      data-motion={motion}
      data-plane={plane}
      className={onSet ? `${styles.shell} ${styles.onSet}` : styles.shell}
    >
      {/* On the set the landing's status bar is the header; the shell hands it the badge and toggle. */}
      {!onSet && (
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
      <main className={onSet ? styles.set : styles.main}>
        {page === undefined ? (
          <NoSignal path={path} />
        ) : page.status === "sealed" ? (
          <SealedDoor page={page} />
        ) : onSet ? (
          <LandingPage
            plane={plane}
            controls={
              <>
                {badge}
                {toggle}
              </>
            }
          />
        ) : (
          <Placeholder page={page} />
        )}
      </main>
    </div>
  );
}

export function Shell() {
  const { path, page } = useRoute(PAGES);
  const plane = usePlane();
  const [theme, toggleTheme] = useTheme();
  const { motion } = usePreferences();
  const [gotoOpen, setGotoOpen] = useState(false);
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
          // Reserved for the replay-only daemon sample toggle (spec landing); unhandled until then.
          return false;
      }
    },
    [page, gotoOpen, toggleTheme],
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
      onToggleTheme={toggleTheme}
      onCloseGoto={closeGoto}
    />
  );
}
