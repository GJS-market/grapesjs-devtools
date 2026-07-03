import { describe, it, expect } from 'vitest';
import { safeSerialize, previewValue, previewArgs } from './serialize';

// Minimal Backbone-ish stand-ins.
function makeModel(cid: string, attrs: Record<string, unknown>) {
  return { cid, attributes: attrs, toJSON: () => attrs };
}

describe('safeSerialize', () => {
  it('passes primitives through', () => {
    expect(safeSerialize(1)).toBe(1);
    expect(safeSerialize('x')).toBe('x');
    expect(safeSerialize(true)).toBe(true);
    expect(safeSerialize(null)).toBe(null);
  });

  it('maps undefined and bigint to markers/strings', () => {
    expect(safeSerialize(undefined)).toBe('[undefined]');
    expect(safeSerialize(10n)).toBe('10n');
  });

  it('renders functions with their name', () => {
    function foo() {}
    expect(safeSerialize(foo)).toBe('[Function: foo]');
    expect(safeSerialize(() => {})).toMatch(/^\[Function:/);
  });

  it('converts Backbone-ish models to {__model, cid, attrs}', () => {
    const model = makeModel('c1', { type: 'text', content: 'hi' });
    const out = safeSerialize(model) as Record<string, unknown>;
    expect(out.__model).toBe('text');
    expect(out.cid).toBe('c1');
    expect(out.attrs).toEqual({ type: 'text', content: 'hi' });
  });

  it('converts Backbone-ish collections to {__collection, length, models}', () => {
    const coll = { models: [makeModel('c1', { type: 'a' })], length: 1 };
    const out = safeSerialize(coll) as Record<string, unknown>;
    expect(out.__collection).toBe(true);
    expect(out.length).toBe(1);
    expect(Array.isArray(out.models)).toBe(true);
  });

  it('guards against circular references', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    const out = safeSerialize(a) as Record<string, unknown>;
    expect(out.name).toBe('a');
    expect(out.self).toBe('[Circular]');
  });

  it('honours maxDepth', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const out = safeSerialize(deep, { maxDepth: 2 }) as any;
    // depth 0=root obj, 1=a, 2=b -> b's value replaced with {…}
    expect(out.a.b).toBe('{…}');
  });

  it('truncates long arrays', () => {
    const arr = Array.from({ length: 10 }, (_, i) => i);
    const out = safeSerialize(arr, { maxArrayLength: 3 }) as unknown[];
    expect(out.length).toBe(4); // 3 + "more" marker
    expect(out[3]).toContain('more');
  });

  it('truncates many object keys', () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 10; i++) obj['k' + i] = i;
    const out = safeSerialize(obj, { maxKeys: 3 }) as Record<string, unknown>;
    expect(out['…']).toContain('more keys');
  });

  it('serializes Error instances', () => {
    const out = safeSerialize(new TypeError('boom')) as Record<string, unknown>;
    expect(out.__error).toBe('TypeError');
    expect(out.message).toBe('boom');
  });

  it('never throws on a toJSON that throws', () => {
    const bad = {
      cid: 'c9',
      attributes: {},
      toJSON: () => {
        throw new Error('nope');
      },
    };
    const out = safeSerialize(bad) as Record<string, unknown>;
    expect(out.cid).toBe('c9');
    expect(out.attrs).toBe('[toJSON failed]');
  });
});

describe('previewValue / previewArgs', () => {
  it('quotes strings and stringifies numbers', () => {
    expect(previewValue('hi')).toBe('"hi"');
    expect(previewValue(42)).toBe('42');
  });

  it('summarizes arrays and objects', () => {
    expect(previewValue([1, 2, 3])).toBe('Array(3)');
    expect(previewValue({ a: 1, b: 2 })).toBe('{a, b}');
  });

  it('summarizes models', () => {
    expect(previewValue(makeModel('c1', { type: 'text' }))).toBe('text#c1');
  });

  it('truncates to maxLen', () => {
    const long = 'x'.repeat(200);
    const out = previewValue(long, 20);
    expect(out.length).toBe(20);
    expect(out.endsWith('…')).toBe(true);
  });

  it('previewArgs handles empty, single and multiple args', () => {
    expect(previewArgs([])).toBe('');
    expect(previewArgs(['a'])).toBe('"a"');
    expect(previewArgs([1, 2])).toBe('Array(2)');
  });
});
