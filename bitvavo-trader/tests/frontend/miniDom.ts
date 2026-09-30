/**
 * Een iets rijkere nep-DOM dan `fakeNode` (helpers.ts): elementen met kinderen, zodat
 * panelen die elementen maken, verplaatsen (`append`) en weghalen (`remove`) in Node
 * getest kunnen worden. Geen HTML-parser: `innerHTML` is alleen een string.
 */
export type MiniNode = any;

let created = 0;
/** Aantal elementen dat `miniNode` sinds de laatste reset gemaakt heeft */
export const createdCount = () => created;
export const resetCreated = () => {
  created = 0;
};

/** `[data-x]` of `[data-x="v"]` (ook `.klasse`) tegen één element */
function matches(node: MiniNode, sel: string): boolean {
  const attr = /^\[data-([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
  if (attr) {
    const key = attr[1].replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
    const v = node.dataset[key];
    return attr[2] === undefined ? v !== undefined && v !== "" : v === attr[2];
  }
  if (sel.startsWith(".")) return node.classList.contains(sel.slice(1));
  return node.tagName === sel.toUpperCase();
}

export function miniNode(tag = "div"): MiniNode {
  created++;
  const classes = new Set<string>();
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const attrs: Record<string, string> = {};
  const style: Record<string, string> & { setProperty?: (k: string, v: string) => void } = {};
  style.setProperty = (k: string, v: string) => {
    style[k] = v;
  };
  const node: MiniNode = {
    tagName: tag.toUpperCase(),
    children: [] as MiniNode[],
    parentNode: null as MiniNode,
    dataset: {} as Record<string, string>,
    style,
    attrs,
    listeners,
    textContent: "",
    innerHTML: "",
    title: "",
    hidden: false,
    disabled: false,
    value: "",
    type: "",
    get className() {
      return [...classes].join(" ");
    },
    set className(v: string) {
      classes.clear();
      String(v)
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => classes.add(c));
    },
    classList: {
      add: (...c: string[]) => c.forEach((x) => classes.add(x)),
      remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
      toggle: (c: string, on?: boolean) => ((on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c)),
      contains: (c: string) => classes.has(c),
    },
    setAttribute(k: string, v: unknown) {
      attrs[k] = String(v);
    },
    getAttribute(k: string) {
      return k in attrs ? attrs[k] : null;
    },
    removeAttribute(k: string) {
      delete attrs[k];
    },
    append(...nodes: MiniNode[]) {
      for (const n of nodes) {
        if (!n || typeof n !== "object") continue;
        if (n.parentNode) n.remove();
        n.parentNode = node;
        node.children.push(n);
      }
    },
    appendChild(n: MiniNode) {
      node.append(n);
      return n;
    },
    remove() {
      const p = node.parentNode;
      if (!p) return;
      const i = p.children.indexOf(node);
      if (i >= 0) p.children.splice(i, 1);
      node.parentNode = null;
    },
    contains(n: MiniNode) {
      for (let x = n; x; x = x.parentNode) if (x === node) return true;
      return false;
    },
    closest(sel: string) {
      for (let x: MiniNode = node; x; x = x.parentNode) if (matches(x, sel)) return x;
      return null;
    },
    querySelector(sel: string) {
      const stack = [...node.children];
      while (stack.length) {
        const n = stack.shift();
        if (matches(n, sel)) return n;
        stack.unshift(...n.children);
      }
      return null;
    },
    querySelectorAll(sel: string) {
      const out: MiniNode[] = [];
      const walk = (n: MiniNode) => {
        for (const c of n.children) {
          if (matches(c, sel)) out.push(c);
          walk(c);
        }
      };
      walk(node);
      return out;
    },
    addEventListener(type: string, fn: (e: unknown) => void) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener(type: string, fn: (e: unknown) => void) {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn);
    },
    /** Event afvuren op dit element (geen bubbling) */
    fire(type: string, event: Record<string, unknown> = {}) {
      for (const fn of listeners[type] || []) fn({ preventDefault() {}, stopPropagation() {}, ...event });
    },
    focus() {},
    scrollIntoView() {},
  };
  return node;
}

/** Alle nakomelingen met deze klasse (diepte-eerst) */
export function findAll(root: MiniNode, cls: string): MiniNode[] {
  return root.querySelectorAll(`.${cls}`);
}
