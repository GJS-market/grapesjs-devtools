import type { DevtoolsModule, ModuleContext } from '../../types';
import { h, clear } from '../../utils/dom';
import { renderJson } from '../../utils/json-viewer';

const HISTORY_KEY = 'gjs-devtools-repl-history';
const HISTORY_MAX = 100;

const SNIPPETS: string[] = [
  'editor.getSelected()',
  'editor.getHtml()',
  'editor.getCss()',
  'editor.getComponents().length',
  'editor.getWrapper().toJSON()',
  'editor.UndoManager.getStack()',
  'editor.getProjectData()',
  'editor.Commands.getAll()',
];

/**
 * Console / REPL — evaluates JavaScript with `editor` and `$0` (the selected
 * component) in scope, rendering results through the shared JSON viewer.
 *
 * Security: this executes arbitrary JS in the page context. It is a
 * development-only tool; a visible warning is shown in the UI.
 */
export class ReplModule implements DevtoolsModule {
  readonly id = 'repl';
  readonly title = 'Console';

  private readonly ctx: ModuleContext;
  private history: string[] = [];
  private historyIndex = -1;
  private draft = '';

  private outEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private acEl!: HTMLElement;
  private acItems: string[] = [];
  private acIndex = -1;
  private memberCache: string[] | null = null;

  constructor(ctx: ModuleContext) {
    this.ctx = ctx;
    this.history = this.loadHistory();
    this.historyIndex = this.history.length;
  }

  mount(el: HTMLElement): void {
    const warn = h('div', {
      class: 'gjs-dt-repl-warn',
      text: '⚠ Executes arbitrary JS in the page context — development only.',
    });

    const snips = h('div', { class: 'gjs-dt-repl-snips' });
    for (const code of SNIPPETS) {
      snips.appendChild(
        h('button', {
          class: 'gjs-dt-btn gjs-dt-repl-snip',
          text: code,
          onclick: () => {
            this.inputEl.value = code;
            this.autosize();
            this.inputEl.focus();
          },
        }),
      );
    }

    this.outEl = h('div', { class: 'gjs-dt-repl-out' });
    this.acEl = h('div', { class: 'gjs-dt-repl-ac', style: 'display:none' });
    this.inputEl = h('textarea', {
      class: 'gjs-dt-repl-input',
      placeholder: 'JS with `editor` and `$0` in scope — Enter to run, Shift+Enter for newline',
      rows: 1,
    }) as HTMLTextAreaElement;

    this.inputEl.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.inputEl.addEventListener('input', () => {
      this.autosize();
      this.updateAutocomplete();
    });

    const inputWrap = h(
      'div',
      { class: 'gjs-dt-repl-inputwrap' },
      this.acEl,
      this.inputEl,
    );

    el.appendChild(
      h(
        'div',
        { class: 'gjs-dt-repl' },
        warn,
        snips,
        this.outEl,
        inputWrap,
      ),
    );
  }

  activate(): void {
    this.inputEl?.focus();
  }

  destroy(): void {
    this.memberCache = null;
  }

  // ── Input handling ──────────────────────────────────────────────────────

  private onKeyDown(e: KeyboardEvent): void {
    // Autocomplete navigation takes priority when the dropdown is open.
    if (this.acEl.style.display !== 'none') {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.moveAc(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.moveAc(-1);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && this.acIndex >= 0)) {
        e.preventDefault();
        this.acceptAc();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.hideAc();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.run();
      return;
    }
    if (e.key === 'ArrowUp' && this.isCaretAtStart()) {
      e.preventDefault();
      this.navigateHistory(-1);
      return;
    }
    if (e.key === 'ArrowDown' && this.isCaretAtEnd()) {
      e.preventDefault();
      this.navigateHistory(1);
    }
  }

  private isCaretAtStart(): boolean {
    return (
      this.inputEl.selectionStart === 0 && this.inputEl.selectionEnd === 0
    );
  }

  private isCaretAtEnd(): boolean {
    const len = this.inputEl.value.length;
    return (
      this.inputEl.selectionStart === len && this.inputEl.selectionEnd === len
    );
  }

  private navigateHistory(dir: number): void {
    if (!this.history.length) return;
    if (this.historyIndex === this.history.length) {
      this.draft = this.inputEl.value;
    }
    const next = this.historyIndex + dir;
    if (next < 0) return;
    if (next >= this.history.length) {
      this.historyIndex = this.history.length;
      this.inputEl.value = this.draft;
    } else {
      this.historyIndex = next;
      this.inputEl.value = this.history[next];
    }
    this.autosize();
  }

  private autosize(): void {
    this.inputEl.style.height = 'auto';
    this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 160)}px`;
  }

  // ── Evaluation ──────────────────────────────────────────────────────────

  private run(): void {
    const code = this.inputEl.value.trim();
    if (!code) return;
    this.pushHistory(code);
    this.inputEl.value = '';
    this.draft = '';
    this.autosize();
    this.hideAc();

    const entry = h('div', { class: 'gjs-dt-repl-entry' });
    entry.appendChild(h('div', { class: 'gjs-dt-repl-in gjs-dt-mono', text: code }));
    this.outEl.appendChild(entry);

    let result: unknown;
    try {
      result = this.evaluate(code);
    } catch (err) {
      entry.appendChild(this.renderError(err));
      this.scrollOut();
      return;
    }

    if (this.isThenable(result)) {
      const pending = h('div', { class: 'gjs-dt-repl-async', text: '⏳ async…' });
      entry.appendChild(pending);
      Promise.resolve(result).then(
        (val) => {
          pending.remove();
          entry.appendChild(
            h('span', { class: 'gjs-dt-repl-async', text: 'async → ' }),
          );
          entry.appendChild(renderJson(val));
          this.scrollOut();
        },
        (err) => {
          pending.remove();
          entry.appendChild(this.renderError(err));
          this.scrollOut();
        },
      );
    } else {
      entry.appendChild(renderJson(result));
    }
    this.scrollOut();
  }

  private evaluate(code: string): unknown {
    const editor = this.ctx.editor;
    const $0 = editor.getSelected();
    let fn: (editor: unknown, $0: unknown) => unknown;
    try {
      // Prefer expression form so bare values echo like a console.
      fn = new Function('editor', '$0', `return (${code});`) as typeof fn;
    } catch {
      // Fall back to statement form (assignments, multi-line, etc.).
      fn = new Function('editor', '$0', code) as typeof fn;
    }
    return fn(editor, $0);
  }

  private isThenable(v: unknown): v is Promise<unknown> {
    return (
      typeof v === 'object' &&
      v !== null &&
      typeof (v as { then?: unknown }).then === 'function'
    );
  }

  private renderError(err: unknown): HTMLElement {
    let text: string;
    if (err instanceof Error) {
      const stack = (err.stack ?? `${err.name}: ${err.message}`)
        .split('\n')
        .slice(0, 3)
        .join('\n');
      text = stack;
    } else {
      text = String(err);
    }
    return h('div', { class: 'gjs-dt-repl-err', text });
  }

  private scrollOut(): void {
    this.outEl.scrollTop = this.outEl.scrollHeight;
  }

  // ── History persistence ─────────────────────────────────────────────────

  private pushHistory(code: string): void {
    if (this.history[this.history.length - 1] !== code) {
      this.history.push(code);
      if (this.history.length > HISTORY_MAX) this.history.shift();
      this.saveHistory();
    }
    this.historyIndex = this.history.length;
  }

  private loadHistory(): string[] {
    try {
      const raw = sessionStorage.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private saveHistory(): void {
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(this.history));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }

  // ── Autocomplete ────────────────────────────────────────────────────────

  private updateAutocomplete(): void {
    const upToCaret = this.inputEl.value.slice(
      0,
      this.inputEl.selectionStart ?? this.inputEl.value.length,
    );
    const match = /editor\.(\w*)$/.exec(upToCaret);
    if (!match) {
      this.hideAc();
      return;
    }
    const prefix = match[1];
    const members = this.getMembers();
    this.acItems = members
      .filter((m) => m.toLowerCase().startsWith(prefix.toLowerCase()))
      .slice(0, 30);
    if (!this.acItems.length) {
      this.hideAc();
      return;
    }
    this.acIndex = 0;
    this.renderAc();
  }

  private getMembers(): string[] {
    if (this.memberCache) return this.memberCache;
    const set = new Set<string>();
    let obj: object | null = this.ctx.editor as unknown as object;
    while (obj && obj !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(obj)) {
        if (!key.startsWith('_') && key !== 'constructor') set.add(key);
      }
      obj = Object.getPrototypeOf(obj) as object | null;
    }
    this.memberCache = [...set].sort();
    return this.memberCache;
  }

  private renderAc(): void {
    clear(this.acEl);
    this.acItems.forEach((item, i) => {
      this.acEl.appendChild(
        h('div', {
          class: 'gjs-dt-repl-ac-item' + (i === this.acIndex ? ' is-active' : ''),
          text: item,
          onmousedown: (e: MouseEvent) => {
            e.preventDefault();
            this.acIndex = i;
            this.acceptAc();
          },
        }),
      );
    });
    this.acEl.style.display = '';
  }

  private moveAc(dir: number): void {
    if (!this.acItems.length) return;
    this.acIndex =
      (this.acIndex + dir + this.acItems.length) % this.acItems.length;
    this.renderAc();
  }

  private acceptAc(): void {
    if (this.acIndex < 0 || this.acIndex >= this.acItems.length) return;
    const chosen = this.acItems[this.acIndex];
    const caret = this.inputEl.selectionStart ?? this.inputEl.value.length;
    const before = this.inputEl.value.slice(0, caret);
    const after = this.inputEl.value.slice(caret);
    const replaced = before.replace(/editor\.\w*$/, `editor.${chosen}`);
    this.inputEl.value = replaced + after;
    const newCaret = replaced.length;
    this.inputEl.setSelectionRange(newCaret, newCaret);
    this.hideAc();
    this.inputEl.focus();
  }

  private hideAc(): void {
    this.acEl.style.display = 'none';
    this.acItems = [];
    this.acIndex = -1;
  }
}
