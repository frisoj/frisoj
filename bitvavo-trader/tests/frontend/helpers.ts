/**
 * Hulpjes om de browsermodules uit public/ (plain ES modules zonder types) in
 * Node te testen: laden via een absoluut pad en een minimale nep-DOM.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

/** Laadt `public/<rel>` (geen typings: het resultaat is `any`). */
export async function loadPublic(rel: string): Promise<any> {
  const file = resolve(PUBLIC_DIR, rel);
  return import(/* @vite-ignore */ file);
}

type Handler = (data: unknown) => void;

/** Dezelfde semantiek als public/js/bus.js, met een logje van alle emits. */
export function makeBus() {
  const handlers: Record<string, Handler[]> = {};
  const emitted: { type: string; data: unknown }[] = [];
  return {
    emitted,
    on(type: string, fn: Handler) {
      (handlers[type] ||= []).push(fn);
      return () => {
        handlers[type] = (handlers[type] || []).filter((f) => f !== fn);
      };
    },
    emit(type: string, data?: unknown) {
      emitted.push({ type, data });
      for (const fn of [...(handlers[type] || [])]) fn(data);
    },
  };
}

export type Fake = any;

/** Een nep-element: genoeg voor de panelen die we hier aansturen. */
export function fakeNode(extra: Record<string, unknown> = {}): Fake {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const classes = new Set<string>();
  const node: Fake = {
    innerHTML: "",
    textContent: "",
    title: "",
    hidden: false,
    disabled: false,
    dataset: {},
    style: {},
    listeners,
    classList: {
      add: (...c: string[]) => c.forEach((x) => classes.add(x)),
      remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
      toggle: (c: string, on?: boolean) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)),
      contains: (c: string) => classes.has(c),
    },
    addEventListener(type: string, fn: (e: unknown) => void) {
      (listeners[type] ||= []).push(fn);
    },
    fire(type: string, event: unknown) {
      for (const fn of listeners[type] || []) fn(event);
    },
    append() {},
    appendChild() {},
    remove() {},
    setAttribute() {},
    scrollIntoView() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    ...extra,
  };
  return node;
}

/** Zet de browser-globals die de panelen bij het mounten gebruiken; geeft een opruimfunctie terug. */
export function installBrowserGlobals() {
  const g = globalThis as Record<string, unknown>;
  const keys = ["document", "window", "CSS", "requestAnimationFrame", "localStorage"];
  const saved = Object.fromEntries(keys.map((k) => [k, g[k]]));
  const had = Object.fromEntries(keys.map((k) => [k, k in g]));
  const rafQueue: (() => void)[] = [];
  g.document = {
    // panels.css "is al geladen" → ensureCss() doet niets
    querySelector: () => ({}),
    querySelectorAll: () => [],
    createElement: () => fakeNode(),
    head: fakeNode(),
    body: fakeNode(),
    documentElement: fakeNode(),
    activeElement: null,
  };
  g.window = { addEventListener() {}, LightweightCharts: undefined };
  g.CSS = { escape: (s: string) => s };
  g.localStorage = { getItem: () => "", setItem() {}, removeItem() {} };
  g.requestAnimationFrame = (fn: () => void) => {
    rafQueue.push(fn);
    return rafQueue.length;
  };
  return {
    /** Voert alle ingeplande animation frames uit */
    flushRaf() {
      while (rafQueue.length) rafQueue.shift()!();
    },
    restore() {
      for (const k of keys) {
        if (had[k]) g[k] = saved[k];
        else delete g[k];
      }
    },
  };
}

/** Wacht tot openstaande promises (fetch-stubs, awaits) zijn afgehandeld. */
export async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}
