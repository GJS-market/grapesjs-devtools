import type { DevtoolsModule, ModuleContext } from '../../types';
import { h, clear } from '../../utils/dom';
import { formatTime } from '../../utils/format';
import { previewArgs } from '../../utils/serialize';
import { renderJson } from '../../utils/json-viewer';
import { rafThrottle, type Debounced } from '../../utils/debounce';

interface LogEntry {
  name: string;
  ts: number;
  args: unknown[];
}

interface Group {
  id: string;
  label: string;
  /** Returns true if an event name belongs to this group. */
  test: (name: string) => boolean;
}

const ROW_HEIGHT = 18;

/** Group definitions, evaluated in order; first match wins ('other' is fallback). */
const GROUPS: Group[] = [
  { id: 'component', label: 'component', test: (n) => n.startsWith('component:') },
  {
    id: 'style',
    label: 'style/css',
    test: (n) => n.startsWith('style:') || n.startsWith('css:'),
  },
  { id: 'storage', label: 'storage', test: (n) => n.startsWith('storage:') },
  { id: 'canvas', label: 'canvas', test: (n) => n.startsWith('canvas:') },
  { id: 'block', label: 'block', test: (n) => n.startsWith('block:') },
  { id: 'trait', label: 'trait', test: (n) => n.startsWith('trait:') },
  { id: 'selector', label: 'selector', test: (n) => n.startsWith('selector:') },
  {
    id: 'undo',
    label: 'undo/redo',
    test: (n) => n === 'undo' || n === 'redo' || n.startsWith('undo') || n.startsWith('redo'),
  },
  {
    id: 'command',
    label: 'run/stop',
    test: (n) => n.startsWith('run') || n.startsWith('stop') || n.startsWith('abort'),
  },
];

function groupOf(name: string): string {
  for (const g of GROUPS) if (g.test(name)) return g.id;
  return 'other';
}

/**
 * Event Logger — subscribes to the editor firehose (`'all'`) with a single
 * listener, buffers entries in a ring buffer and renders them in a virtualized
 * list. Previews are computed lazily at render time, so the capture path stays
 * effectively free.
 */
export class EventLoggerModule implements DevtoolsModule {
  readonly id = 'event-logger';
  readonly title = 'Events';

  private readonly ctx: ModuleContext;
  private readonly limit: number;
  private readonly buffer: LogEntry[] = [];

  // Filters.
  private readonly enabledGroups = new Set<string>([
    ...GROUPS.map((g) => g.id),
    'other',
  ]);
  private textFilter = '';

  // Stats.
  private readonly totals = new Map<string, number>();
  private readonly window = new Map<string, number>();
  private readonly maxRate = new Map<string, number>();
  private rateTimer: ReturnType<typeof setInterval> | null = null;

  private paused = false;
  private active = false;
  private view: 'log' | 'stats' = 'log';

  // DOM.
  private rootEl!: HTMLElement;
  private viewportEl!: HTMLElement;
  private spacerEl!: HTMLElement;
  private detailEl!: HTMLElement;
  private statsEl!: HTMLElement;
  private countEl!: HTMLElement;
  private pauseBtn!: HTMLButtonElement;

  private filtered: LogEntry[] = [];
  private selectedTs: number | null = null;
  private scheduleRender!: Debounced<[]>;

  constructor(ctx: ModuleContext) {
    this.ctx = ctx;
    this.limit = Math.max(10, ctx.options.eventLogLimit);
  }

  mount(el: HTMLElement): void {
    this.scheduleRender = rafThrottle(() => this.render());

    const toolbar = this.buildToolbar();
    const groups = this.buildGroupFilters();

    this.viewportEl = h('div', { class: 'gjs-dt-log-viewport' });
    this.spacerEl = h('div', { class: 'gjs-dt-log-spacer' });
    this.viewportEl.appendChild(this.spacerEl);
    this.viewportEl.addEventListener('scroll', () => this.scheduleRender());

    this.detailEl = h('div', {
      class: 'gjs-dt-log-detail',
      style: 'display:none',
    });
    this.statsEl = h('div', {
      class: 'gjs-dt-scroll',
      style: 'display:none',
    });

    this.rootEl = h(
      'div',
      { class: 'gjs-dt-log' },
      toolbar,
      groups,
      this.viewportEl,
      this.detailEl,
      this.statsEl,
    );
    el.appendChild(this.rootEl);

    // Single firehose listener — cheap capture, lazy preview.
    this.ctx.bridge.on('all', (name: string, ...args: unknown[]) => {
      this.onEvent(name, args);
    });
  }

  activate(): void {
    this.active = true;
    if (!this.rateTimer) {
      this.rateTimer = setInterval(() => this.flushRates(), 1000);
    }
    this.render();
  }

  deactivate(): void {
    this.active = false;
    if (this.rateTimer) {
      clearInterval(this.rateTimer);
      this.rateTimer = null;
    }
  }

  destroy(): void {
    this.deactivate();
    this.scheduleRender?.cancel();
    this.buffer.length = 0;
  }

  // ── Capture ────────────────────────────────────────────────────────────

  private onEvent(name: string, args: unknown[]): void {
    // Stats always count, even when paused.
    this.totals.set(name, (this.totals.get(name) ?? 0) + 1);
    this.window.set(name, (this.window.get(name) ?? 0) + 1);

    if (this.paused) return;

    this.buffer.push({ name, ts: Date.now(), args });
    if (this.buffer.length > this.limit) this.buffer.shift();

    if (this.active && this.view === 'log') this.scheduleRender();
  }

  private flushRates(): void {
    for (const [name, count] of this.window) {
      const prev = this.maxRate.get(name) ?? 0;
      if (count > prev) this.maxRate.set(name, count);
    }
    this.window.clear();
    if (this.active && this.view === 'stats') this.renderStats();
  }

  // ── Toolbar / filters ────────────────────────────────────────────────

  private buildToolbar(): HTMLElement {
    const search = h('input', {
      class: 'gjs-dt-input',
      placeholder: 'filter by name…',
      style: 'flex:1 1 120px',
    });
    search.addEventListener('input', () => {
      this.textFilter = search.value.trim().toLowerCase();
      this.render();
    });

    this.pauseBtn = h('button', {
      class: 'gjs-dt-btn',
      text: 'Pause',
      onclick: () => this.togglePause(),
    });
    const clearBtn = h('button', {
      class: 'gjs-dt-btn',
      text: 'Clear',
      onclick: () => this.clearLog(),
    });

    const logTab = h('button', {
      class: 'gjs-dt-btn is-active',
      text: 'Log',
      dataset: { view: 'log' },
      onclick: () => this.setView('log'),
    });
    const statsTab = h('button', {
      class: 'gjs-dt-btn',
      text: 'Stats',
      dataset: { view: 'stats' },
      onclick: () => this.setView('stats'),
    });

    this.countEl = h('span', { class: 'gjs-dt-muted', text: '0' });

    return h(
      'div',
      { class: 'gjs-dt-toolbar' },
      logTab,
      statsTab,
      search,
      this.pauseBtn,
      clearBtn,
      this.countEl,
    );
  }

  private buildGroupFilters(): HTMLElement {
    const wrap = h('div', { class: 'gjs-dt-log-groups' });
    const groups = [...GROUPS, { id: 'other', label: 'other', test: () => true }];
    for (const g of groups) {
      const cb = h('input', {
        type: 'checkbox',
        checked: true,
      }) as HTMLInputElement;
      cb.checked = true;
      cb.addEventListener('change', () => {
        if (cb.checked) this.enabledGroups.add(g.id);
        else this.enabledGroups.delete(g.id);
        this.render();
      });
      wrap.appendChild(h('label', {}, cb, g.label));
    }
    return wrap;
  }

  private setView(view: 'log' | 'stats'): void {
    this.view = view;
    for (const btn of Array.from(
      this.rootEl.querySelectorAll<HTMLElement>('[data-view]'),
    )) {
      btn.classList.toggle('is-active', btn.dataset.view === view);
    }
    const isLog = view === 'log';
    this.viewportEl.style.display = isLog ? '' : 'none';
    this.detailEl.style.display = isLog && this.selectedTs != null ? '' : 'none';
    this.statsEl.style.display = isLog ? 'none' : '';
    if (isLog) this.render();
    else this.renderStats();
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.pauseBtn.textContent = this.paused ? 'Resume' : 'Pause';
    this.pauseBtn.classList.toggle('is-active', this.paused);
    if (!this.paused) this.render();
  }

  private clearLog(): void {
    this.buffer.length = 0;
    this.selectedTs = null;
    this.detailEl.style.display = 'none';
    this.render();
  }

  // ── Rendering (virtualized) ────────────────────────────────────────────

  private matches(entry: LogEntry): boolean {
    if (!this.enabledGroups.has(groupOf(entry.name))) return false;
    if (this.textFilter && !entry.name.toLowerCase().includes(this.textFilter)) {
      return false;
    }
    return true;
  }

  private render(): void {
    if (!this.active || this.view !== 'log') return;

    this.filtered = this.buffer.filter((e) => this.matches(e));
    this.countEl.textContent = `${this.filtered.length}/${this.buffer.length}`;

    const total = this.filtered.length;
    this.spacerEl.style.height = `${total * ROW_HEIGHT}px`;

    // Keep pinned to bottom if the user was already near the bottom.
    const nearBottom =
      this.viewportEl.scrollTop + this.viewportEl.clientHeight >=
      this.spacerEl.offsetHeight - ROW_HEIGHT * 2;

    // Remove old rows (keep spacer).
    for (const row of Array.from(
      this.viewportEl.querySelectorAll('.gjs-dt-log-row'),
    )) {
      row.remove();
    }

    const scrollTop = nearBottom
      ? total * ROW_HEIGHT
      : this.viewportEl.scrollTop;
    const height = this.viewportEl.clientHeight || 300;
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 2);
    const end = Math.min(total, Math.ceil((scrollTop + height) / ROW_HEIGHT) + 2);

    for (let i = start; i < end; i++) {
      this.viewportEl.appendChild(this.renderRow(this.filtered[i], i));
    }

    if (nearBottom) this.viewportEl.scrollTop = total * ROW_HEIGHT;
  }

  private renderRow(entry: LogEntry, index: number): HTMLElement {
    const row = h(
      'div',
      {
        class: 'gjs-dt-log-row',
        style: { top: `${index * ROW_HEIGHT}px`, height: `${ROW_HEIGHT}px` },
      },
      h('span', { class: 'gjs-dt-log-time', text: formatTime(entry.ts) }),
      h('span', { class: 'gjs-dt-log-name', text: entry.name }),
      h('span', {
        class: 'gjs-dt-log-preview',
        text: previewArgs(entry.args),
      }),
    );
    if (entry.ts === this.selectedTs) row.classList.add('is-selected');
    row.addEventListener('click', () => this.showDetail(entry));
    return row;
  }

  private showDetail(entry: LogEntry): void {
    if (this.selectedTs === entry.ts) {
      // Toggle off.
      this.selectedTs = null;
      this.detailEl.style.display = 'none';
      this.render();
      return;
    }
    this.selectedTs = entry.ts;
    clear(this.detailEl);
    this.detailEl.appendChild(
      h(
        'div',
        { class: 'gjs-dt-toolbar' },
        h('span', { class: 'gjs-dt-log-name', text: entry.name }),
        h('span', { class: 'gjs-dt-muted', text: formatTime(entry.ts) }),
      ),
    );
    this.detailEl.appendChild(
      renderJson(entry.args.length === 1 ? entry.args[0] : entry.args, {
        expandDepth: 2,
      }),
    );
    this.detailEl.style.display = '';
    this.render();
  }

  // ── Stats ──────────────────────────────────────────────────────────────

  private renderStats(): void {
    clear(this.statsEl);
    const toolbar = h(
      'div',
      { class: 'gjs-dt-toolbar' },
      h('button', {
        class: 'gjs-dt-btn',
        text: 'Reset stats',
        onclick: () => {
          this.totals.clear();
          this.window.clear();
          this.maxRate.clear();
          this.renderStats();
        },
      }),
      h('span', {
        class: 'gjs-dt-muted',
        text: 'Rows in orange fired > 50×/s (potential spam)',
      }),
    );

    const table = h('table', { class: 'gjs-dt-stats-table' });
    table.appendChild(
      h(
        'tr',
        {},
        h('th', { text: 'Event' }),
        h('th', { text: 'Count' }),
        h('th', { text: 'Max/s' }),
      ),
    );
    const rows = [...this.totals.entries()].sort((a, b) => b[1] - a[1]);
    for (const [name, count] of rows) {
      const rate = this.maxRate.get(name) ?? 0;
      const tr = h(
        'tr',
        {},
        h('td', { text: name }),
        h('td', { text: String(count) }),
        h('td', { text: rate ? String(rate) : '—' }),
      );
      if (rate > 50) tr.classList.add('is-spam');
      table.appendChild(tr);
    }
    if (!rows.length) {
      this.statsEl.appendChild(
        h('div', { class: 'gjs-dt-empty', text: 'No events yet' }),
      );
    }
    this.statsEl.appendChild(toolbar);
    this.statsEl.appendChild(table);
  }
}
