// The right column's two tabs (character-control "Creator UI"): Mood (the dial, gestures, voice)
// and Look (Palette, Shape). A `role="tablist"` with automatic activation: arrow keys move to the
// other tab, Home and End to the first and last; those keys are kept from the shell, which steps
// channels on arrows. Both panels stay mounted (the hidden one `hidden`), so nothing in either
// loses its state on a switch.
import type { KeyboardEvent, ReactNode } from "react";
import styles from "./Look.module.css";

export type SignalTab = "mood" | "look";

export const SIGNAL_TABS: readonly { id: SignalTab; label: string }[] = [
  { id: "mood", label: "Mood" },
  { id: "look", label: "Look" },
];

export interface SignalTabsProps {
  tab: SignalTab;
  onTab: (tab: SignalTab) => void;
  panels: Readonly<Record<SignalTab, ReactNode>>;
}

const tabId = (id: SignalTab): string => `signal-tab-${id}`;
const panelId = (id: SignalTab): string => `signal-panel-${id}`;

export function SignalTabs({ tab, onTab, panels }: SignalTabsProps) {
  const go = (i: number, list: HTMLElement): void => {
    const next = SIGNAL_TABS[(i + SIGNAL_TABS.length) % SIGNAL_TABS.length];
    if (next === undefined) return;
    onTab(next.id);
    list.querySelector<HTMLElement>(`#${tabId(next.id)}`)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const at = SIGNAL_TABS.findIndex((t) => t.id === tab);
    if (event.key === "ArrowRight" || event.key === "ArrowDown") go(at + 1, event.currentTarget);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") go(at - 1, event.currentTarget);
    else if (event.key === "Home") go(0, event.currentTarget);
    else if (event.key === "End") go(SIGNAL_TABS.length - 1, event.currentTarget);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <>
      <div className={styles.tabs} role="tablist" aria-label="Signal" onKeyDown={onKeyDown}>
        {SIGNAL_TABS.map((t) => (
          <button
            key={t.id}
            id={tabId(t.id)}
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={t.id === tab}
            aria-controls={panelId(t.id)}
            tabIndex={t.id === tab ? 0 : -1}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {SIGNAL_TABS.map((t) => (
        <div key={t.id} id={panelId(t.id)} role="tabpanel" aria-labelledby={tabId(t.id)} className={styles.panel} hidden={t.id !== tab}>
          {panels[t.id]}
        </div>
      ))}
    </>
  );
}
