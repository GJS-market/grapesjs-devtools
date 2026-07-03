/**
 * Tiny vanilla-DOM helpers. Keeps module code declarative without pulling in a
 * UI framework (the plugin ships with zero runtime dependencies).
 */

type Child = Node | string | number | null | undefined | false;

export interface ElProps {
  class?: string;
  className?: string;
  text?: string;
  html?: string;
  title?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  style?: Partial<CSSStyleDeclaration> | string;
  dataset?: Record<string, string>;
  attrs?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Create an element. `props` covers the common cases; `on*` keys become event
 * listeners; anything else is set as a property when possible, else an attribute.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(props)) {
    if (val == null) continue;
    if (key === 'class' || key === 'className') {
      el.className = String(val);
    } else if (key === 'text') {
      el.textContent = String(val);
    } else if (key === 'html') {
      el.innerHTML = String(val);
    } else if (key === 'style') {
      if (typeof val === 'string') el.setAttribute('style', val);
      else Object.assign(el.style, val);
    } else if (key === 'dataset') {
      Object.assign(el.dataset, val as Record<string, string>);
    } else if (key === 'attrs') {
      for (const [a, v] of Object.entries(val as Record<string, string>)) {
        el.setAttribute(a, v);
      }
    } else if (key.startsWith('on') && typeof val === 'function') {
      el.addEventListener(
        key.slice(2).toLowerCase(),
        val as EventListener,
      );
    } else {
      try {
        (el as unknown as Record<string, unknown>)[key] = val;
      } catch {
        el.setAttribute(key, String(val));
      }
    }
  }
  append(el, children);
  return el;
}

/** Append a flat or nested list of children, ignoring nullish/false entries. */
export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child == null || child === false) continue;
    parent.appendChild(
      child instanceof Node ? child : document.createTextNode(String(child)),
    );
  }
}

/** Remove all children of `el`. */
export function clear(el: Node): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/**
 * Attach a listener and return a disposer. Handy for module-local DOM listeners
 * that must be cleaned up in `destroy()`.
 */
export function on<T extends EventTarget>(
  target: T,
  event: string,
  handler: EventListenerOrEventListenerObject,
  opts?: AddEventListenerOptions | boolean,
): () => void {
  target.addEventListener(event, handler, opts);
  return () => target.removeEventListener(event, handler, opts);
}

/** Copy text to the clipboard, falling back to a hidden textarea. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = h('textarea', {
      value: text,
      style: 'position:fixed;opacity:0;pointer-events:none;',
    });
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Trigger a browser download of `text` as a file. */
export function downloadFile(
  filename: string,
  text: string,
  mime = 'application/json',
): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
