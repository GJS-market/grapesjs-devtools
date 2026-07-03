import type { DevtoolsModule, ModuleContext } from '../../types';
import { h, clear, copyText, downloadFile } from '../../utils/dom';
import { renderJson } from '../../utils/json-viewer';
import { diffJson } from '../../utils/json-diff';
import { highlightHtml, highlightCss } from '../../utils/syntax-highlight';
import { formatTime, fileTimestamp, byteLength, formatBytes } from '../../utils/format';
import { previewValue } from '../../utils/serialize';
import { debounce, type Debounced } from '../../utils/debounce';

type SubTab = 'data' | 'diff' | 'io' | 'html' | 'css' | 'log';

interface StorageLogEntry {
  name: string;
  ts: number;
  args: unknown[];
}

/**
 * Storage & Data — inspect and manipulate the project data: JSON tree, a
 * structural diff between snapshots, export/import, live HTML/CSS output, and a
 * storage-event log.
 */
export class StorageDataModule implements DevtoolsModule {
  readonly id = 'storage-data';
  readonly title = 'Storage';

  private readonly ctx: ModuleContext;
  private sub: SubTab = 'data';
  private snapshots: unknown[] = [];
  private readonly log: StorageLogEntry[] = [];

  private tabsEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private refreshCode!: Debounced<[]>;

  constructor(ctx: ModuleContext) {
    this.ctx = ctx;
  }

  mount(el: HTMLElement): void {
    this.tabsEl = h('div', { class: 'gjs-dt-toolbar' });
    this.bodyEl = h('div', { class: 'gjs-dt-scroll gjs-dt-sd-body' });
    el.appendChild(h('div', { class: 'gjs-dt-sd' }, this.tabsEl, this.bodyEl));

    this.buildTabs();
    this.refreshCode = debounce(() => {
      if (this.sub === 'html' || this.sub === 'css') this.render();
    }, 300);

    const { bridge } = this.ctx;
    bridge.on('storage:store', () => {
      this.pushSnapshot();
      if (this.sub === 'data') this.render();
    });
    for (const ev of [
      'storage:start',
      'storage:end',
      'storage:load',
      'storage:store',
      'storage:error',
    ]) {
      bridge.on(ev, (...args: unknown[]) => {
        this.log.push({ name: ev, ts: Date.now(), args });
        if (this.log.length > 200) this.log.shift();
        if (this.sub === 'log') this.render();
      });
    }
    bridge.on('update', () => this.refreshCode());

    this.render();
  }

  activate(): void {
    this.render();
  }

  destroy(): void {
    this.refreshCode?.cancel();
    this.snapshots = [];
    this.log.length = 0;
  }

  // ── Tabs ───────────────────────────────────────────────────────────────

  private buildTabs(): void {
    clear(this.tabsEl);
    const tabs: [SubTab, string][] = [
      ['data', 'Project Data'],
      ['diff', 'Diff'],
      ['io', 'Export/Import'],
      ['html', 'HTML'],
      ['css', 'CSS'],
      ['log', 'Storage Log'],
    ];
    for (const [id, label] of tabs) {
      this.tabsEl.appendChild(
        h('button', {
          class: 'gjs-dt-btn' + (this.sub === id ? ' is-active' : ''),
          text: label,
          onclick: () => {
            this.sub = id;
            this.buildTabs();
            this.render();
          },
        }),
      );
    }
  }

  // ── Render dispatch ──────────────────────────────────────────────────

  private render(): void {
    clear(this.bodyEl);
    switch (this.sub) {
      case 'data':
        return this.renderData();
      case 'diff':
        return this.renderDiff();
      case 'io':
        return this.renderIo();
      case 'html':
        return this.renderCode('html');
      case 'css':
        return this.renderCode('css');
      case 'log':
        return this.renderLog();
    }
  }

  private projectData(): unknown {
    try {
      return this.ctx.editor.getProjectData();
    } catch {
      return {};
    }
  }

  private pushSnapshot(): void {
    this.snapshots.push(this.projectData());
    if (this.snapshots.length > 2) this.snapshots.shift();
  }

  // ── Project Data ─────────────────────────────────────────────────────

  private renderData(): void {
    const data = this.projectData();
    const search = h('input', {
      class: 'gjs-dt-input',
      placeholder: 'filter top-level keys…',
      style: 'flex:1 1 auto',
    }) as HTMLInputElement;
    const bar = h(
      'div',
      { class: 'gjs-dt-toolbar' },
      h('button', {
        class: 'gjs-dt-btn',
        text: 'Refresh',
        onclick: () => this.render(),
      }),
      h('button', {
        class: 'gjs-dt-btn',
        text: 'Snapshot',
        onclick: () => {
          this.pushSnapshot();
        },
      }),
      search,
    );
    const treeWrap = h('div', {});
    const draw = () => {
      clear(treeWrap);
      const q = search.value.trim().toLowerCase();
      let view = data;
      if (q && data && typeof data === 'object' && !Array.isArray(data)) {
        view = Object.fromEntries(
          Object.entries(data as Record<string, unknown>).filter(([k]) =>
            k.toLowerCase().includes(q),
          ),
        );
      }
      treeWrap.appendChild(renderJson(view, { expandDepth: 2 }));
    };
    search.addEventListener('input', draw);
    this.bodyEl.appendChild(bar);
    this.bodyEl.appendChild(treeWrap);
    draw();
  }

  // ── Diff ─────────────────────────────────────────────────────────────

  private renderDiff(): void {
    const bar = h(
      'div',
      { class: 'gjs-dt-toolbar' },
      h('button', {
        class: 'gjs-dt-btn',
        text: 'Take snapshot',
        onclick: () => {
          this.pushSnapshot();
          this.render();
        },
      }),
      h('span', {
        class: 'gjs-dt-muted',
        text: `${this.snapshots.length}/2 snapshots (diff = older → newer)`,
      }),
    );
    this.bodyEl.appendChild(bar);

    if (this.snapshots.length < 2) {
      this.bodyEl.appendChild(
        h('div', {
          class: 'gjs-dt-empty',
          text: 'Need two snapshots. They are captured on each save (storage:store) and via "Take snapshot".',
        }),
      );
      return;
    }
    const [a, b] = this.snapshots;
    const entries = diffJson(a, b);
    if (!entries.length) {
      this.bodyEl.appendChild(
        h('div', { class: 'gjs-dt-empty', text: 'No differences' }),
      );
      return;
    }
    const list = h('div', { class: 'gjs-dt-sd-diff' });
    for (const e of entries) {
      const cls =
        e.type === 'added'
          ? 'gjs-dt-diff-added'
          : e.type === 'removed'
            ? 'gjs-dt-diff-removed'
            : 'gjs-dt-diff-changed';
      const detail =
        e.type === 'changed'
          ? `${previewValue(e.before)} → ${previewValue(e.after)}`
          : e.type === 'added'
            ? previewValue(e.after)
            : previewValue(e.before);
      list.appendChild(
        h(
          'div',
          { class: 'gjs-dt-sd-diffrow ' + cls },
          h('span', { class: 'gjs-dt-sd-diffsign', text: this.diffSign(e.type) }),
          h('span', { class: 'gjs-dt-mono gjs-dt-sd-diffpath', text: e.path }),
          h('span', { class: 'gjs-dt-muted gjs-dt-sd-diffval', text: detail }),
        ),
      );
    }
    this.bodyEl.appendChild(list);
  }

  private diffSign(type: string): string {
    return type === 'added' ? '+' : type === 'removed' ? '−' : '~';
  }

  // ── Export / Import ──────────────────────────────────────────────────

  private renderIo(): void {
    const exportBtn = h('button', {
      class: 'gjs-dt-btn',
      text: 'Export project data',
      onclick: () => {
        const json = JSON.stringify(this.projectData(), null, 2);
        downloadFile(`project-data-${fileTimestamp(Date.now())}.json`, json);
      },
    });

    const fileInput = h('input', {
      type: 'file',
      attrs: { accept: 'application/json,.json' },
    }) as HTMLInputElement;
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => this.tryImport(String(reader.result), status);
      reader.readAsText(file);
    });

    const textarea = h('textarea', {
      class: 'gjs-dt-input',
      placeholder: 'paste project-data JSON here…',
      style: 'width:100%;min-height:120px;font-family:var(--gjs-dt-mono)',
    }) as HTMLTextAreaElement;

    const importBtn = h('button', {
      class: 'gjs-dt-btn',
      text: 'Import pasted JSON',
      onclick: () => this.tryImport(textarea.value, status),
    });

    const status = h('div', { class: 'gjs-dt-muted', style: 'margin-top:6px' });

    this.bodyEl.appendChild(
      h(
        'div',
        { class: 'gjs-dt-sd-io' },
        h('div', { class: 'gjs-dt-section' }, h('h4', { text: 'Export' }), exportBtn),
        h(
          'div',
          { class: 'gjs-dt-section' },
          h('h4', { text: 'Import' }),
          h('div', { class: 'gjs-dt-muted', text: 'From file:' }),
          fileInput,
          h('div', { class: 'gjs-dt-muted', style: 'margin-top:8px', text: 'Or paste JSON:' }),
          textarea,
          h('div', { style: 'margin-top:6px' }, importBtn),
          status,
        ),
      ),
    );
  }

  private tryImport(raw: string, status: HTMLElement): void {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      status.textContent = `Invalid JSON: ${(err as Error).message}`;
      status.className = 'gjs-dt-sd-err';
      return;
    }
    if (!window.confirm('Import will overwrite the current project. Continue?')) {
      return;
    }
    try {
      this.ctx.editor.loadProjectData(data as never);
      status.textContent = 'Imported ✓';
      status.className = 'gjs-dt-sd-ok';
    } catch (err) {
      status.textContent = `Load failed: ${(err as Error).message}`;
      status.className = 'gjs-dt-sd-err';
    }
  }

  // ── HTML / CSS ───────────────────────────────────────────────────────

  private renderCode(kind: 'html' | 'css'): void {
    let code = '';
    try {
      code = kind === 'html' ? this.ctx.editor.getHtml() : this.ctx.editor.getCss() ?? '';
    } catch {
      code = '';
    }
    const bar = h(
      'div',
      { class: 'gjs-dt-toolbar' },
      h('button', { class: 'gjs-dt-btn', text: 'Refresh', onclick: () => this.render() }),
      h('button', {
        class: 'gjs-dt-btn',
        text: 'Copy',
        onclick: () => copyText(code),
      }),
      h('span', { class: 'gjs-dt-muted', text: formatBytes(byteLength(code)) }),
    );
    const pre = h('pre', { class: 'gjs-dt-code gjs-dt-mono' });
    pre.innerHTML = kind === 'html' ? highlightHtml(code) : highlightCss(code);
    this.bodyEl.appendChild(bar);
    this.bodyEl.appendChild(pre);
  }

  // ── Storage Log ──────────────────────────────────────────────────────

  private renderLog(): void {
    const bar = h(
      'div',
      { class: 'gjs-dt-toolbar' },
      h('button', {
        class: 'gjs-dt-btn',
        text: 'Clear',
        onclick: () => {
          this.log.length = 0;
          this.render();
        },
      }),
      h('span', { class: 'gjs-dt-muted', text: `${this.log.length} event(s)` }),
    );
    this.bodyEl.appendChild(bar);
    if (!this.log.length) {
      this.bodyEl.appendChild(
        h('div', { class: 'gjs-dt-empty', text: 'No storage events yet' }),
      );
      return;
    }
    for (const entry of [...this.log].reverse()) {
      const row = h(
        'div',
        { class: 'gjs-dt-sd-logrow' },
        h('span', { class: 'gjs-dt-log-time', text: formatTime(entry.ts) }),
        h('span', { class: 'gjs-dt-log-name', text: entry.name }),
        h('span', {
          class: 'gjs-dt-log-preview',
          text: entry.args.length ? previewValue(entry.args[0]) : '',
        }),
      );
      const detail = h('div', { style: 'display:none' });
      let open = false;
      row.addEventListener('click', () => {
        open = !open;
        if (open && !detail.childElementCount) {
          detail.appendChild(
            renderJson(entry.args.length === 1 ? entry.args[0] : entry.args, {
              expandDepth: 2,
            }),
          );
        }
        detail.style.display = open ? '' : 'none';
      });
      this.bodyEl.appendChild(row);
      this.bodyEl.appendChild(detail);
    }
  }
}
