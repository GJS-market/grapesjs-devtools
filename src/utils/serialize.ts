/**
 * Safe serializer for arbitrary editor payloads.
 *
 * GrapesJS event arguments are frequently Backbone models / collections and DOM
 * nodes, which are cyclic and enormous. This produces a JSON-friendly, bounded,
 * cycle-safe representation suitable for the JSON viewer used by the event logger
 * and the REPL.
 *
 * Rules:
 * - Backbone-ish models (have `.cid` + `.toJSON`)  -> `{ __model, cid, attrs }`
 * - Backbone-ish collections (have `.models`)      -> `{ __collection, length, models }`
 * - DOM elements                                   -> `"<tag#id.class>"`
 * - Functions                                      -> `"[Function: name]"`
 * - Depth beyond `maxDepth`                         -> `"[…]"` / `"{…}"`
 * - Cyclic references                              -> `"[Circular]"`
 */

export interface SerializeOptions {
  /** Maximum nesting depth. Default: 4. */
  maxDepth?: number;
  /** Maximum array/collection entries kept. Default: 100. */
  maxArrayLength?: number;
  /** Maximum object keys kept. Default: 100. */
  maxKeys?: number;
}

const DEFAULTS: Required<SerializeOptions> = {
  maxDepth: 4,
  maxArrayLength: 100,
  maxKeys: 100,
};

interface ModelLike {
  cid: string;
  toJSON: () => unknown;
  attributes?: Record<string, unknown>;
}

interface CollectionLike {
  models: unknown[];
  length: number;
}

function isModelLike(v: unknown): v is ModelLike {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as ModelLike).cid === 'string' &&
    typeof (v as ModelLike).toJSON === 'function'
  );
}

function isCollectionLike(v: unknown): v is CollectionLike {
  return (
    typeof v === 'object' &&
    v !== null &&
    Array.isArray((v as CollectionLike).models)
  );
}

function isElement(v: unknown): v is Element {
  return (
    typeof Element !== 'undefined' &&
    v instanceof Element
  );
}

function describeElement(el: Element): string {
  const id = el.id ? `#${el.id}` : '';
  const cls =
    typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).join('.')
      : '';
  return `<${el.tagName.toLowerCase()}${id}${cls}>`;
}

/** Best-effort model "type" (GrapesJS components expose `get('type')`). */
function modelType(model: ModelLike): string {
  try {
    const attrs = model.attributes;
    if (attrs && typeof attrs.type === 'string') return attrs.type;
    if (attrs && typeof attrs.tagName === 'string') return attrs.tagName;
  } catch {
    /* ignore */
  }
  return 'Model';
}

/**
 * Convert `input` to a JSON-safe value. Never throws.
 */
export function safeSerialize(
  input: unknown,
  options: SerializeOptions = {},
): unknown {
  const opts = { ...DEFAULTS, ...options };
  const seen = new WeakSet<object>();

  function walk(value: unknown, depth: number): unknown {
    // Primitives
    if (value === null) return null;
    const t = typeof value;
    if (t === 'string' || t === 'boolean' || t === 'number') return value;
    if (t === 'bigint') return `${(value as bigint).toString()}n`;
    if (t === 'undefined') return '[undefined]';
    if (t === 'symbol') return String(value as symbol);
    if (t === 'function') {
      const name = (value as { name?: string }).name || 'anonymous';
      return `[Function: ${name}]`;
    }

    // DOM
    if (isElement(value)) return describeElement(value);
    if (typeof Node !== 'undefined' && value instanceof Node) {
      return `[${value.nodeName}]`;
    }

    // From here on `value` is a non-null object
    const obj = value as object;
    if (seen.has(obj)) return '[Circular]';

    if (depth >= opts.maxDepth) {
      if (Array.isArray(value) || isCollectionLike(value)) return '[…]';
      return '{…}';
    }

    seen.add(obj);
    try {
      // Backbone-ish collection
      if (isCollectionLike(value)) {
        const models = value.models
          .slice(0, opts.maxArrayLength)
          .map((m) => walk(m, depth + 1));
        const out: Record<string, unknown> = {
          __collection: true,
          length: value.length,
          models,
        };
        if (value.length > opts.maxArrayLength) {
          out.truncated = value.length - opts.maxArrayLength;
        }
        return out;
      }

      // Backbone-ish model
      if (isModelLike(value)) {
        let attrs: unknown;
        try {
          attrs = walk(value.toJSON(), depth + 1);
        } catch {
          attrs = '[toJSON failed]';
        }
        return { __model: modelType(value), cid: value.cid, attrs };
      }

      // Plain array
      if (Array.isArray(value)) {
        const arr = value
          .slice(0, opts.maxArrayLength)
          .map((v) => walk(v, depth + 1));
        if (value.length > opts.maxArrayLength) {
          arr.push(`[…${value.length - opts.maxArrayLength} more]`);
        }
        return arr;
      }

      // Error
      if (value instanceof Error) {
        return { __error: value.name, message: value.message };
      }

      // Plain object
      const out: Record<string, unknown> = {};
      const keys = Object.keys(value as Record<string, unknown>);
      for (const key of keys.slice(0, opts.maxKeys)) {
        try {
          out[key] = walk(
            (value as Record<string, unknown>)[key],
            depth + 1,
          );
        } catch {
          out[key] = '[unreadable]';
        }
      }
      if (keys.length > opts.maxKeys) {
        out['…'] = `${keys.length - opts.maxKeys} more keys`;
      }
      return out;
    } finally {
      seen.delete(obj);
    }
  }

  return walk(input, 0);
}

/**
 * One-line, length-bounded preview of a value (for log rows). Built lazily so it
 * never runs on the hot capture path.
 */
export function previewValue(value: unknown, maxLen = 120): string {
  let str: string;
  try {
    str = compactPreview(value);
  } catch {
    str = String(value);
  }
  if (str.length > maxLen) str = str.slice(0, maxLen - 1) + '…';
  return str;
}

function compactPreview(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(value);
  if (t === 'undefined') return 'undefined';
  if (t === 'function') {
    return `ƒ ${(value as { name?: string }).name || 'anonymous'}()`;
  }
  if (isElement(value)) return describeElement(value);
  if (isModelLike(value)) return `${modelType(value)}#${value.cid}`;
  if (isCollectionLike(value)) return `Collection(${value.length})`;
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (t === 'object') {
    const keys = Object.keys(value as object);
    return `{${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''}}`;
  }
  return String(value);
}

/** Build a one-line preview of a list of event arguments. */
export function previewArgs(args: unknown[], maxLen = 120): string {
  if (!args.length) return '';
  return previewValue(
    args.length === 1 ? args[0] : args,
    maxLen,
  );
}
