/**
 * Tiny, dependency-free syntax highlighters for HTML and CSS.
 *
 * These are intentionally lightweight tokenizers (not full parsers): good
 * enough to colourise the Storage & Data module's HTML/CSS output. Input is
 * escaped first, so the returned string is safe to assign to `innerHTML`.
 *
 * Token wrapper classes: `gjs-dt-tok-tag`, `-attr`, `-string`, `-comment`,
 * `-punct`, `-prop`, `-value`, `-selector`, `-at`.
 */

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function span(cls: string, text: string): string {
  return `<span class="gjs-dt-tok-${cls}">${text}</span>`;
}

/**
 * Highlight an HTML string. Recognises comments, tags, attribute names and
 * quoted attribute values.
 */
export function highlightHtml(input: string): string {
  let out = '';
  let i = 0;
  const n = input.length;

  while (i < n) {
    // Comment.
    if (input.startsWith('<!--', i)) {
      const end = input.indexOf('-->', i);
      const stop = end === -1 ? n : end + 3;
      out += span('comment', esc(input.slice(i, stop)));
      i = stop;
      continue;
    }
    // Tag.
    if (input[i] === '<') {
      const end = input.indexOf('>', i);
      const stop = end === -1 ? n : end + 1;
      out += highlightHtmlTag(input.slice(i, stop));
      i = stop;
      continue;
    }
    // Text until next tag.
    const next = input.indexOf('<', i);
    const stop = next === -1 ? n : next;
    out += esc(input.slice(i, stop));
    i = stop;
  }
  return out;
}

function highlightHtmlTag(tag: string): string {
  // tag looks like `<div class="x">` or `</div>` or `<br/>`.
  const m = /^<\/?\s*([a-zA-Z0-9-]+)/.exec(tag);
  if (!m) return esc(tag);
  const nameEnd = m.index + m[0].length;
  let out = span('punct', esc(tag.slice(0, m[0].indexOf(m[1])))); // '<' or '</'
  out += span('tag', esc(m[1]));

  const rest = tag.slice(nameEnd);
  // Colour attr="value" pairs; leave the rest as punctuation.
  out += rest.replace(
    /([a-zA-Z_:@][\w:.-]*)(\s*=\s*)("[^"]*"|'[^']*')?|(\/?>)/g,
    (_full, attr, eq, val, close) => {
      if (close) return span('punct', esc(close));
      let piece = span('attr', esc(attr));
      if (eq) piece += span('punct', esc(eq));
      if (val) piece += span('string', esc(val));
      return piece;
    },
  );
  return out;
}

/** Index of the `}` matching the `{` at `open` (balanced), or `s.length`. */
function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let k = open; k < s.length; k++) {
    if (s[k] === '{') depth++;
    else if (s[k] === '}') {
      depth--;
      if (depth === 0) return k;
    }
  }
  return s.length;
}

/**
 * Highlight a CSS string. Recognises comments, at-rules, selectors, property
 * names and values. Nested at-rules (e.g. `@media { .a { … } }`) are handled by
 * recursing into the block body.
 */
export function highlightCss(input: string): string {
  let out = '';
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i];

    // Comment.
    if (input.startsWith('/*', i)) {
      const end = input.indexOf('*/', i);
      const stop = end === -1 ? n : end + 2;
      out += span('comment', esc(input.slice(i, stop)));
      i = stop;
      continue;
    }

    // Block: `{ … }`. Balance nested braces; recurse if the body has nested
    // rules, otherwise treat it as a declaration body.
    if (ch === '{') {
      const end = matchBrace(input, i);
      const inner = input.slice(i + 1, end);
      out += span('punct', '{');
      out += inner.includes('{') ? highlightCss(inner) : highlightCssBody(inner);
      if (end < n) out += span('punct', '}');
      i = end < n ? end + 1 : n;
      continue;
    }

    // Stray closing brace (safety — keeps the walker moving).
    if (ch === '}') {
      out += span('punct', '}');
      i++;
      continue;
    }

    // At-rule prelude (e.g. `@media (...)`) up to `{` or `;`.
    if (ch === '@') {
      const brace = input.indexOf('{', i);
      const semi = input.indexOf(';', i);
      let stop: number;
      if (brace === -1 && semi === -1) stop = n;
      else if (brace === -1) stop = semi;
      else if (semi === -1) stop = brace;
      else stop = Math.min(brace, semi);
      out += span('at', esc(input.slice(i, stop)));
      // A statement at-rule (`@import …;`) — consume its terminating semicolon.
      if (stop === semi && semi !== -1) {
        out += span('punct', ';');
        i = stop + 1;
      } else {
        i = stop;
      }
      continue;
    }

    // Selector text up to the next `{`, `}`, `@` or comment.
    let j = i;
    while (j < n && input[j] !== '{' && input[j] !== '}' && input[j] !== '@') {
      if (input.startsWith('/*', j)) break;
      j++;
    }
    if (j === i) {
      // No progress possible on this char — emit and advance defensively.
      out += esc(input[i]);
      i++;
      continue;
    }
    const sel = input.slice(i, j);
    out += sel.trim() ? span('selector', esc(sel)) : esc(sel);
    i = j;
  }
  return out;
}

function highlightCssBody(body: string): string {
  // Split into `prop: value;` declarations, keeping separators.
  return body.replace(
    /([^:;{}]+)(:)([^;{}]*)(;?)/g,
    (_full, prop, colon, value, semi) => {
      return (
        span('prop', esc(prop)) +
        span('punct', esc(colon)) +
        span('value', esc(value)) +
        (semi ? span('punct', esc(semi)) : '')
      );
    },
  );
}
