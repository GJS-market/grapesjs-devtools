import type { Component } from 'grapesjs';
import type { DevtoolsModule, ModuleContext } from '../../types';
import { h, clear } from '../../utils/dom';
import { previewValue } from '../../utils/serialize';

interface Metrics {
  components: number;
  cssRules: number;
  selectors: number;
  /** `null` when the private event bus can't be read. */
  listeners: number | null;
  undoStack: number;
}

const METRIC_LABELS: Record<keyof Metrics, string> = {
  components: 'Components',
  cssRules: 'CSS rules',
  selectors: 'Selectors',
  listeners: 'editor listeners',
  undoStack: 'Undo stack',
};

/**
 * Performance & Diagnostics — live counters, UndoManager controls, a canvas
 * re-render timer and a simple leak detector (baseline → action → compare).
 *
 * ## Private-API reliance
 * The `listeners` metric reads `editor.getModel()._events` (an internal Backbone
 * structure) and the undo stack-entry internals are not part of the public API.
 * Both are isolated in `try/catch` and degrade to `n/a` rather than throwing, so
 * the module keeps working if GrapesJS changes these internals.
 */
export class PerformanceModule implements DevtoolsModule {
  readonly id = 'performance';
  readonly title = 'Perf';

  private readonly ctx: ModuleContext;
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = false;

  private componentCount: number | null = null; // cached walk result
  private renderSamples: number[] = [];
  private baseline: Metrics | null = null;
  private comparison: Metrics | null = null;

  private metricsEl!: HTMLElement;
  private undoEl!: HTMLElement;
  private renderEl!: HTMLElement;
  private leakEl!: HTMLElement;

  constructor(ctx: ModuleContext) {
    this.ctx = ctx;
  }

  mount(el: HTMLElement): void {
    this.metricsEl = h('div', { class: 'gjs-dt-section' });
    this.undoEl = h('div', { class: 'gjs-dt-section' });
    this.renderEl = h('div', { class: 'gjs-dt-section' });
    this.leakEl = h('div', { class: 'gjs-dt-section' });
    el.appendChild(
      h(
        'div',
        { class: 'gjs-dt-scroll gjs-dt-perf' },
        this.metricsEl,
        this.undoEl,
        this.renderEl,
        this.leakEl,
      ),
    );

    // Invalidate the component-count cache on structural changes.
    this.ctx.bridge.on('component:add', () => (this.componentCount = null));
    this.ctx.bridge.on('component:remove', () => (this.componentCount = null));

    this.renderUndo();
    this.renderRender();
    this.renderLeak();
    this.renderMetrics();
  }

  activate(): void {
    this.active = true;
    this.componentCount = null;
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), 1000);
    }
    this.tick();
  }

  deactivate(): void {
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  destroy(): void {
    this.deactivate();
    this.baseline = null;
    this.comparison = null;
  }

  private tick(): void {
    if (!this.active) return;
    this.renderMetrics();
    this.renderUndo();
  }

  // ── Metrics ────────────────────────────────────────────────────────────

  private countComponents(): number {
    if (this.componentCount != null) return this.componentCount;
    let n = 0;
    const wrapper = this.ctx.editor.getWrapper() as Component | undefined;
    const visit = (c: Component) => {
      n++;
      const kids = c.components();
      for (let i = 0; i < kids.length; i++) visit(kids.at(i) as Component);
    };
    if (wrapper) visit(wrapper);
    this.componentCount = n;
    return n;
  }

  /** Sum of handler-array lengths on the private editor event bus, or null. */
  private countListeners(): number | null {
    try {
      const model = (this.ctx.editor as unknown as {
        getModel: () => { _events?: Record<string, unknown[]> };
      }).getModel();
      const events = model._events;
      if (!events) return null;
      let total = 0;
      for (const key of Object.keys(events)) {
        const handlers = events[key];
        if (Array.isArray(handlers)) total += handlers.length;
      }
      return total;
    } catch {
      return null;
    }
  }

  private collect(): Metrics {
    const ed = this.ctx.editor;
    const safeLen = (fn: () => { length: number }): number => {
      try {
        return fn().length;
      } catch {
        return 0;
      }
    };
    return {
      components: this.countComponents(),
      cssRules: safeLen(() => ed.Css.getAll() as unknown as { length: number }),
      selectors: safeLen(() => ed.Selectors.getAll() as unknown as { length: number }),
      listeners: this.countListeners(),
      undoStack: safeLen(() => ed.UndoManager.getStack()),
    };
  }

  private renderMetrics(): void {
    const m = this.collect();
    clear(this.metricsEl);
    this.metricsEl.appendChild(h('h4', { text: 'Live metrics' }));
    const grid = h('div', { class: 'gjs-dt-kv' });
    (Object.keys(METRIC_LABELS) as (keyof Metrics)[]).forEach((key) => {
      const value = m[key];
      grid.appendChild(h('span', { class: 'gjs-dt-kv-key', text: METRIC_LABELS[key] }));
      grid.appendChild(
        h('span', {
          class: 'gjs-dt-mono' + (value == null ? ' gjs-dt-muted' : ''),
          text: value == null ? 'n/a' : String(value),
        }),
      );
    });
    this.metricsEl.appendChild(grid);
  }

  // ── UndoManager ──────────────────────────────────────────────────────

  private renderUndo(): void {
    const um = this.ctx.editor.UndoManager;
    let stack: unknown[] = [];
    let hasUndo = false;
    let hasRedo = false;
    try {
      stack = um.getStack();
      hasUndo = um.hasUndo();
      hasRedo = um.hasRedo();
    } catch {
      /* ignore */
    }

    clear(this.undoEl);
    this.undoEl.appendChild(h('h4', { text: `UndoManager (stack: ${stack.length})` }));

    const undoBtn = h('button', {
      class: 'gjs-dt-btn',
      text: 'Undo',
      onclick: () => {
        try {
          um.undo();
        } catch {
          /* ignore */
        }
        this.renderUndo();
        this.renderMetrics();
      },
    }) as HTMLButtonElement;
    undoBtn.disabled = !hasUndo;
    const redoBtn = h('button', {
      class: 'gjs-dt-btn',
      text: 'Redo',
      onclick: () => {
        try {
          um.redo();
        } catch {
          /* ignore */
        }
        this.renderUndo();
        this.renderMetrics();
      },
    }) as HTMLButtonElement;
    redoBtn.disabled = !hasRedo;
    this.undoEl.appendChild(h('div', { class: 'gjs-dt-toolbar' }, undoBtn, redoBtn));

    const list = h('div', { class: 'gjs-dt-mono', style: 'font-size:11px' });
    const recent = stack.slice(-20).reverse();
    if (!recent.length) {
      list.appendChild(h('div', { class: 'gjs-dt-muted', text: '(empty)' }));
    }
    recent.forEach((entry, i) => {
      list.appendChild(
        h('div', {
          class: 'gjs-dt-perf-undorow',
          text: `${stack.length - 1 - i}. ${this.describeUndo(entry)}`,
        }),
      );
    });
    this.undoEl.appendChild(list);
  }

  /** Best-effort one-liner for an undo-stack entry (internal shape may vary). */
  private describeUndo(entry: unknown): string {
    try {
      const e = entry as {
        type?: string;
        after?: { cid?: string };
        object?: { cid?: string };
        options?: unknown;
      };
      const type = e.type ?? 'change';
      const cid = e.after?.cid ?? e.object?.cid ?? '';
      return `${type}${cid ? ' · ' + cid : ''}`;
    } catch {
      return previewValue(entry, 60);
    }
  }

  // ── Measure render ───────────────────────────────────────────────────

  private renderRender(): void {
    clear(this.renderEl);
    this.renderEl.appendChild(h('h4', { text: 'Canvas render' }));
    this.renderEl.appendChild(
      h('div', {
        class: 'gjs-dt-toolbar',
      },
      h('button', {
        class: 'gjs-dt-btn',
        text: 'Measure render',
        onclick: () => this.measureRender(),
      }),
      h('button', {
        class: 'gjs-dt-btn',
        text: 'Reset',
        onclick: () => {
          this.renderSamples = [];
          this.renderRender();
        },
      })),
    );
    if (!this.renderSamples.length) {
      this.renderEl.appendChild(h('div', { class: 'gjs-dt-muted', text: 'No samples yet' }));
      return;
    }
    const min = Math.min(...this.renderSamples);
    const max = Math.max(...this.renderSamples);
    const avg = this.renderSamples.reduce((a, b) => a + b, 0) / this.renderSamples.length;
    const grid = h('div', { class: 'gjs-dt-kv' });
    const fmt = (v: number) => `${v.toFixed(2)} ms`;
    grid.appendChild(h('span', { class: 'gjs-dt-kv-key', text: 'samples' }));
    grid.appendChild(h('span', { class: 'gjs-dt-mono', text: String(this.renderSamples.length) }));
    grid.appendChild(h('span', { class: 'gjs-dt-kv-key', text: 'min' }));
    grid.appendChild(h('span', { class: 'gjs-dt-mono', text: fmt(min) }));
    grid.appendChild(h('span', { class: 'gjs-dt-kv-key', text: 'avg' }));
    grid.appendChild(h('span', { class: 'gjs-dt-mono', text: fmt(avg) }));
    grid.appendChild(h('span', { class: 'gjs-dt-kv-key', text: 'max' }));
    grid.appendChild(h('span', { class: 'gjs-dt-mono', text: fmt(max) }));
    this.renderEl.appendChild(grid);
  }

  private measureRender(): void {
    const t0 = performance.now();
    try {
      this.ctx.editor.Canvas.refresh();
    } catch {
      /* ignore */
    }
    const dt = performance.now() - t0;
    this.renderSamples.push(dt);
    if (this.renderSamples.length > 10) this.renderSamples.shift();
    this.renderRender();
  }

  // ── Leak detector ────────────────────────────────────────────────────

  private renderLeak(): void {
    clear(this.leakEl);
    this.leakEl.appendChild(h('h4', { text: 'Leak detector' }));
    this.leakEl.appendChild(
      h('div', { class: 'gjs-dt-muted', style: 'margin-bottom:6px' }, [
        'Take a baseline, perform an action and its undo (e.g. add then remove a ',
        'component), then Compare. Growing listeners/components indicate a leak.',
      ].join('')),
    );
    this.leakEl.appendChild(
      h(
        'div',
        { class: 'gjs-dt-toolbar' },
        h('button', {
          class: 'gjs-dt-btn',
          text: 'Take baseline',
          onclick: () => {
            this.baseline = this.collect();
            this.comparison = null;
            this.renderLeak();
          },
        }),
        h('button', {
          class: 'gjs-dt-btn',
          text: 'Compare',
          onclick: () => {
            if (!this.baseline) return;
            this.comparison = this.collect();
            this.renderLeak();
          },
        }),
      ),
    );

    if (!this.baseline) {
      this.leakEl.appendChild(h('div', { class: 'gjs-dt-muted', text: 'No baseline taken' }));
      return;
    }
    const table = h('table', { class: 'gjs-dt-stats-table' });
    table.appendChild(
      h(
        'tr',
        {},
        h('th', { text: 'Metric' }),
        h('th', { text: 'Base' }),
        h('th', { text: 'Now' }),
        h('th', { text: 'Δ' }),
      ),
    );
    (Object.keys(METRIC_LABELS) as (keyof Metrics)[]).forEach((key) => {
      const before = this.baseline![key];
      const after = this.comparison ? this.comparison[key] : null;
      const delta =
        before != null && after != null ? after - before : null;
      const tr = h(
        'tr',
        {},
        h('td', { text: METRIC_LABELS[key] }),
        h('td', { text: before == null ? 'n/a' : String(before) }),
        h('td', { text: after == null ? '—' : String(after) }),
        h('td', { text: delta == null ? '—' : (delta > 0 ? '+' : '') + delta }),
      );
      if (delta != null && delta > 0) tr.classList.add('is-spam');
      table.appendChild(tr);
    });
    this.leakEl.appendChild(table);
  }
}
