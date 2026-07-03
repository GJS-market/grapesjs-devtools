import { describe, it, expect } from 'vitest';
import { highlightHtml, highlightCss } from './syntax-highlight';

// Strip span wrappers to recover the plain (still HTML-escaped) text, so we can
// assert the tokenizer preserves content exactly.
function strip(html: string): string {
  return html.replace(/<span class="gjs-dt-tok-[a-z]+">/g, '').replace(/<\/span>/g, '');
}

describe('highlightHtml', () => {
  it('preserves the original text (escaped) losslessly', () => {
    const src = '<div class="a">Hi & <b>bold</b></div>';
    const expected = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    expect(strip(highlightHtml(src))).toBe(expected);
  });

  it('wraps tag names and attributes', () => {
    const out = highlightHtml('<a href="x">');
    expect(out).toContain('gjs-dt-tok-tag');
    expect(out).toContain('gjs-dt-tok-attr');
    expect(out).toContain('gjs-dt-tok-string');
  });

  it('highlights comments', () => {
    const out = highlightHtml('<!-- hi --><p>');
    expect(out).toContain('gjs-dt-tok-comment');
  });

  it('escapes so output is injection-safe', () => {
    const out = highlightHtml('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;');
  });
});

describe('highlightCss', () => {
  it('preserves the original text (escaped) losslessly', () => {
    const src = '.a { color: red; width: 10px; }';
    expect(strip(highlightCss(src))).toBe(src);
  });

  it('wraps selectors, properties and values', () => {
    const out = highlightCss('.btn { color: red; }');
    expect(out).toContain('gjs-dt-tok-selector');
    expect(out).toContain('gjs-dt-tok-prop');
    expect(out).toContain('gjs-dt-tok-value');
  });

  it('highlights at-rules and nested blocks', () => {
    const out = highlightCss('@media (max-width: 992px) { .a { color: blue; } }');
    expect(out).toContain('gjs-dt-tok-at');
    expect(out).toContain('gjs-dt-tok-selector');
    expect(out).toContain('gjs-dt-tok-prop');
  });

  it('highlights comments', () => {
    const out = highlightCss('/* note */ .a { color: red; }');
    expect(out).toContain('gjs-dt-tok-comment');
  });
});
