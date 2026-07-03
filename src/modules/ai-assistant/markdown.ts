import { h, copyText } from '../../utils/dom';
import { escapeHtml } from '../../utils/format';

/**
 * Tiny, dependency-free Markdown → DOM renderer, tuned for AI chat answers:
 * fenced code blocks (with a Copy button), inline code, headings, bold/italic,
 * unordered lists, and paragraphs. All text is escaped — output is injection-safe.
 */
export function renderMarkdown(src: string): HTMLElement {
  const root = h('div', { class: 'gjs-dt-md' });
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    const fence = /^```(\w+)?\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] ?? '';
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      root.appendChild(codeBlock(buf.join('\n'), lang));
      continue;
    }

    // Heading.
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const el = h(`h${Math.min(level + 2, 6)}` as 'h4', {
        class: 'gjs-dt-md-h',
      });
      el.innerHTML = inline(heading[2]);
      root.appendChild(el);
      i++;
      continue;
    }

    // Unordered list.
    if (/^\s*[-*]\s+/.test(line)) {
      const ul = h('ul', { class: 'gjs-dt-md-ul' });
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const li = h('li');
        li.innerHTML = inline(lines[i].replace(/^\s*[-*]\s+/, ''));
        ul.appendChild(li);
        i++;
      }
      root.appendChild(ul);
      continue;
    }

    // Blank line.
    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph (accumulate consecutive non-blank, non-special lines).
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i]) &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    const p = h('p', { class: 'gjs-dt-md-p' });
    p.innerHTML = inline(para.join(' '));
    root.appendChild(p);
  }

  return root;
}

function codeBlock(code: string, lang: string): HTMLElement {
  const pre = h('pre', { class: 'gjs-dt-md-code gjs-dt-mono' });
  pre.textContent = code;
  const copyBtn = h('button', {
    class: 'gjs-dt-btn gjs-dt-md-copy',
    text: 'Copy',
    onclick: () => {
      copyText(code);
      copyBtn.textContent = 'Copied';
      setTimeout(() => (copyBtn.textContent = 'Copy'), 1200);
    },
  });
  const wrap = h('div', { class: 'gjs-dt-md-codewrap' });
  if (lang) {
    wrap.appendChild(h('span', { class: 'gjs-dt-md-lang', text: lang }));
  }
  wrap.appendChild(copyBtn);
  wrap.appendChild(pre);
  return wrap;
}

/** Inline formatting: escape first, then apply code/bold/italic/link spans. */
function inline(text: string): string {
  let out = escapeHtml(text);
  // Inline code (before bold/italic so `*` inside code is left alone).
  out = out.replace(/`([^`]+)`/g, '<code class="gjs-dt-md-ic">$1</code>');
  // Bold.
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic.
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // Links [text](url) — url already escaped; only allow http(s).
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );
  return out;
}
