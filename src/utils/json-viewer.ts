import { h, clear } from './dom';
import { safeSerialize } from './serialize';

/**
 * Collapsible JSON tree viewer used by the event logger and the REPL.
 *
 * Pass any value; it is run through {@link safeSerialize} first, so Backbone
 * models, DOM nodes and cyclic structures are safe to hand in directly.
 */
export interface JsonViewerOptions {
  /** Expand nodes up to this depth on first render. Default: 1. */
  expandDepth?: number;
  /** Serialize before rendering. Default: true. Set false if already safe. */
  serialize?: boolean;
}

export function renderJson(
  value: unknown,
  options: JsonViewerOptions = {},
): HTMLElement {
  const expandDepth = options.expandDepth ?? 1;
  const data = options.serialize === false ? value : safeSerialize(value);
  const root = h('div', { class: 'gjs-dt-json' });
  root.appendChild(buildNode(undefined, data, 0, expandDepth));
  return root;
}

/** Replace the contents of `el` with a fresh JSON tree. */
export function mountJson(
  el: HTMLElement,
  value: unknown,
  options: JsonViewerOptions = {},
): void {
  clear(el);
  el.appendChild(renderJson(value, options));
}

function isExpandable(value: unknown): value is object {
  return (
    typeof value === 'object' &&
    value !== null &&
    (Array.isArray(value) || Object.keys(value).length > 0)
  );
}

function buildNode(
  key: string | number | undefined,
  value: unknown,
  depth: number,
  expandDepth: number,
): HTMLElement {
  const row = h('div', { class: 'gjs-dt-json-row' });

  if (!isExpandable(value)) {
    row.appendChild(keyLabel(key));
    row.appendChild(valueLabel(value));
    return row;
  }

  const isArray = Array.isArray(value);
  const entries: [string, unknown][] = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);

  const expanded = depth < expandDepth;
  const toggle = h('span', {
    class: 'gjs-dt-json-toggle',
    text: expanded ? '▾' : '▸',
  });
  const summary = h(
    'span',
    { class: 'gjs-dt-json-summary' },
    isArray ? `Array(${entries.length})` : `{${entries.length}}`,
  );

  const header = h('div', { class: 'gjs-dt-json-header' }, toggle);
  header.appendChild(keyLabel(key));
  header.appendChild(summary);

  const childrenWrap = h('div', {
    class: 'gjs-dt-json-children',
    style: expanded ? '' : 'display:none',
  });
  let built = false;
  const buildChildren = () => {
    if (built) return;
    built = true;
    for (const [k, v] of entries) {
      childrenWrap.appendChild(
        buildNode(isArray ? Number(k) : k, v, depth + 1, expandDepth),
      );
    }
  };
  if (expanded) buildChildren();

  let open = expanded;
  header.addEventListener('click', () => {
    open = !open;
    toggle.textContent = open ? '▾' : '▸';
    if (open) buildChildren();
    childrenWrap.style.display = open ? '' : 'none';
  });

  row.appendChild(header);
  row.appendChild(childrenWrap);
  return row;
}

function keyLabel(key: string | number | undefined): Node {
  if (key === undefined) return document.createTextNode('');
  return h('span', { class: 'gjs-dt-json-key', text: `${key}: ` });
}

function valueLabel(value: unknown): HTMLElement {
  let cls = 'gjs-dt-json-val';
  let text: string;
  if (value === null) {
    cls += ' is-null';
    text = 'null';
  } else if (typeof value === 'string') {
    cls += ' is-string';
    text = `"${value}"`;
  } else if (typeof value === 'number') {
    cls += ' is-number';
    text = String(value);
  } else if (typeof value === 'boolean') {
    cls += ' is-boolean';
    text = String(value);
  } else {
    text = String(value);
  }
  return h('span', { class: cls, text });
}
