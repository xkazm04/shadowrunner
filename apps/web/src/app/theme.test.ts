import { THEME_NAMES } from "@sr/theme";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import indexHtml from "../../index.html?raw";
import {
  BASELINE_FROM,
  defaultTheme,
  isThemeName,
  nextTheme,
  readStoredTheme,
  resolveTheme,
  storeTheme,
  THEME_STORAGE_KEY,
  type ThemeStorage,
} from "./theme";

const LAST_HALLOWEEN_DAY = new Date(2026, 11, 31, 23, 59, 59, 999);
const FIRST_BASELINE_DAY = new Date(2027, 0, 1, 0, 0, 0, 0);

describe("defaultTheme", () => {
  it("is halloween through 2026-12-31 and baseline from 2027-01-01 (local time)", () => {
    expect(defaultTheme(LAST_HALLOWEEN_DAY)).toBe("halloween");
    expect(defaultTheme(FIRST_BASELINE_DAY)).toBe("baseline");
    fc.assert(
      fc.property(fc.date({ min: new Date(2000, 0, 1), max: new Date(2100, 0, 1), noInvalidDate: true }), (d) => {
        expect(defaultTheme(d)).toBe(d.getTime() < FIRST_BASELINE_DAY.getTime() ? "halloween" : "baseline");
      }),
    );
  });
});

describe("resolveTheme", () => {
  it("prefers a valid stored choice, else falls back to the date default", () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: null }), fc.boolean(), (stored, late) => {
        const now = late ? FIRST_BASELINE_DAY : LAST_HALLOWEEN_DAY;
        const expected = isThemeName(stored) ? stored : defaultTheme(now);
        expect(resolveTheme(stored, now)).toBe(expected);
      }),
    );
    expect(resolveTheme("baseline", LAST_HALLOWEEN_DAY)).toBe("baseline");
    expect(resolveTheme("halloween", FIRST_BASELINE_DAY)).toBe("halloween");
  });
});

it("nextTheme follows THEME_NAMES order and wraps", () => {
  THEME_NAMES.forEach((theme, i) => {
    expect(nextTheme(theme)).toBe(THEME_NAMES[(i + 1) % THEME_NAMES.length]);
  });
});

describe("storage", () => {
  it("round-trips through a Storage under the theme key", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    storeTheme(storage, "baseline");
    expect(data.get(THEME_STORAGE_KEY)).toBe("baseline");
    expect(readStoredTheme(storage)).toBe("baseline");
  });

  it("treats a missing or throwing storage as no choice", () => {
    const throwing = {
      getItem: (): string | null => {
        throw new Error("denied");
      },
      setItem: (): void => {
        throw new Error("denied");
      },
    };
    expect(readStoredTheme(undefined)).toBeNull();
    expect(readStoredTheme(throwing)).toBeNull();
    expect(() => storeTheme(throwing, "halloween")).not.toThrow();
  });
});

describe("index.html boot script", () => {
  const source = /<script id="sr-theme-boot">([\s\S]*?)<\/script>/.exec(indexHtml)?.[1];

  /** Runs the inline script against a fake document, storage and clock; returns data-theme. */
  function boot(storage: ThemeStorage, now: Date): string | undefined {
    if (source === undefined) throw new Error('index.html has no <script id="sr-theme-boot">');
    const dataset: Record<string, string> = {};
    const clock = class extends Date {
      static override now(): number {
        return now.getTime();
      }
    };
    new Function("document", "localStorage", "Date", source)({ documentElement: { dataset } }, storage, clock);
    return dataset.theme;
  }

  function storageWith(stored: string | null): ThemeStorage {
    return {
      getItem: (key) => (key === THEME_STORAGE_KEY ? stored : null),
      setItem: () => undefined,
    };
  }

  const switchAt = new Date(BASELINE_FROM.year, BASELINE_FROM.month, BASELINE_FROM.day);
  const moments = fc.oneof(
    fc.date({ min: new Date(2000, 0, 1), max: new Date(2100, 0, 1), noInvalidDate: true }),
    fc.integer({ min: -2, max: 2 }).map((ms) => new Date(switchAt.getTime() + ms)),
  );
  const stored = fc.option(fc.oneof(fc.constantFrom<string>(...THEME_NAMES), fc.string()), { nil: null });

  it("picks the same theme as resolveTheme for any stored value and date", () => {
    fc.assert(
      fc.property(stored, moments, (value, now) => {
        expect(boot(storageWith(value), now)).toBe(resolveTheme(value, now));
      }),
    );
  });

  it("falls back to the date default when storage throws", () => {
    const throwing: ThemeStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => undefined,
    };
    for (const now of [LAST_HALLOWEEN_DAY, FIRST_BASELINE_DAY]) {
      expect(boot(throwing, now)).toBe(defaultTheme(now));
    }
  });
});
