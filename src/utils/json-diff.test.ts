import { describe, it, expect } from 'vitest';
import { diffJson } from './json-diff';

describe('diffJson', () => {
  it('returns no entries for equal values', () => {
    expect(diffJson({ a: 1 }, { a: 1 })).toEqual([]);
    expect(diffJson([1, 2], [1, 2])).toEqual([]);
    expect(diffJson('x', 'x')).toEqual([]);
  });

  it('detects a changed primitive', () => {
    expect(diffJson({ a: 1 }, { a: 2 })).toEqual([
      { path: 'a', type: 'changed', before: 1, after: 2 },
    ]);
  });

  it('detects added and removed keys', () => {
    const d = diffJson({ a: 1 }, { a: 1, b: 2 });
    expect(d).toEqual([{ path: 'b', type: 'added', after: 2 }]);
    const d2 = diffJson({ a: 1, b: 2 }, { a: 1 });
    expect(d2).toEqual([{ path: 'b', type: 'removed', before: 2 }]);
  });

  it('uses indexed paths for arrays', () => {
    const d = diffJson({ list: [1, 2, 3] }, { list: [1, 9, 3] });
    expect(d).toEqual([
      { path: 'list[1]', type: 'changed', before: 2, after: 9 },
    ]);
  });

  it('handles array growth and shrink', () => {
    expect(diffJson([1], [1, 2])).toEqual([
      { path: '[1]', type: 'added', after: 2 },
    ]);
    expect(diffJson([1, 2], [1])).toEqual([
      { path: '[1]', type: 'removed', before: 2 },
    ]);
  });

  it('produces deep nested paths like the GrapesJS project shape', () => {
    const a = {
      pages: [{ frames: [{ component: { components: [{}, {}, {}, { attributes: { class: 'a' } }] } }] }],
    };
    const b = {
      pages: [{ frames: [{ component: { components: [{}, {}, {}, { attributes: { class: 'b' } }] } }] }],
    };
    expect(diffJson(a, b)).toEqual([
      {
        path: 'pages[0].frames[0].component.components[3].attributes.class',
        type: 'changed',
        before: 'a',
        after: 'b',
      },
    ]);
  });

  it('treats a type change as a change at the path', () => {
    const d = diffJson({ a: { x: 1 } }, { a: [1] });
    expect(d).toEqual([
      { path: 'a', type: 'changed', before: { x: 1 }, after: [1] },
    ]);
  });

  it('labels a whole-value root replacement', () => {
    expect(diffJson(1, 2)).toEqual([
      { path: '(root)', type: 'changed', before: 1, after: 2 },
    ]);
  });

  it('reports multiple independent changes', () => {
    const d = diffJson({ a: 1, b: 2, c: 3 }, { a: 1, b: 20, d: 4 });
    // b changed, c removed, d added (order: keys of union)
    expect(d).toContainEqual({ path: 'b', type: 'changed', before: 2, after: 20 });
    expect(d).toContainEqual({ path: 'c', type: 'removed', before: 3 });
    expect(d).toContainEqual({ path: 'd', type: 'added', after: 4 });
    expect(d).toHaveLength(3);
  });
});
