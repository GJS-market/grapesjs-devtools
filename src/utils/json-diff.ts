/**
 * Structural JSON diff — no external dependencies.
 *
 * Walks two JSON-ish values and reports every leaf/branch that was added,
 * removed, or changed, keyed by a dotted + indexed path such as
 * `pages[0].frames[0].component.components[3].attributes.class`.
 */

export type DiffType = 'added' | 'removed' | 'changed';

export interface DiffEntry {
  path: string;
  type: DiffType;
  /** Previous value (absent for `added`). */
  before?: unknown;
  /** Next value (absent for `removed`). */
  after?: unknown;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Append a key/index to a path using dotted (`.key`) or indexed (`[i]`) form. */
function join(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`;
  return base ? `${base}.${key}` : key;
}

/** Deep structural equality for primitives/arrays/objects. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

/**
 * Compute the ordered list of differences turning `a` into `b`.
 * Entries are produced in a stable, depth-first order.
 */
export function diffJson(a: unknown, b: unknown): DiffEntry[] {
  const out: DiffEntry[] = [];
  walk(a, b, '', out);
  return out;
}

function walk(a: unknown, b: unknown, path: string, out: DiffEntry[]): void {
  if (deepEqual(a, b)) return;

  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  const aObj = isObject(a);
  const bObj = isObject(b);

  // Same container kind → recurse into keys/indices.
  if (aArr && bArr) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const p = join(path, i);
      if (i >= a.length) out.push({ path: p, type: 'added', after: b[i] });
      else if (i >= b.length) out.push({ path: p, type: 'removed', before: a[i] });
      else walk(a[i], b[i], p, out);
    }
    return;
  }

  if (aObj && bObj) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      const p = join(path, key);
      const inA = key in a;
      const inB = key in b;
      if (!inA) out.push({ path: p, type: 'added', after: b[key] });
      else if (!inB) out.push({ path: p, type: 'removed', before: a[key] });
      else walk(a[key], b[key], p, out);
    }
    return;
  }

  // Different kinds or differing primitives → a change at this path.
  // Root-level whole-value replacement uses '(root)' for readability.
  out.push({ path: path || '(root)', type: 'changed', before: a, after: b });
}
