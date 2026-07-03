import type { Component, CssRule } from 'grapesjs';
import type { DevtoolsModule, ModuleContext } from '../../types';
import { h, clear } from '../../utils/dom';
import { debounce, type Debounced } from '../../utils/debounce';

type Mode = 'selected' | 'all';

/**
 * Style Inspector — shows the CSS rules that apply to the selected component
 * (with cascade-override strike-through) and a searchable table of every
 * project rule, plus a dead-rule scanner.
 *
 * Public API (via `ctx.getModule('style-inspector')`):
 * - {@link StyleInspectorModule.filterBySelector}
 *
 * ## Limitations of the `el.matches()` approach
 * Matching is done against the element's *current* DOM state, so:
 * - State rules (`:hover`, `:active`, …) are matched on their **base** selector
 *   (state stripped) and shown as "applies" even though the state isn't live.
 * - Pseudo-elements (`::before`/`::after`) and other non-rendered states can't
 *   be verified against a real element; they are listed but flagged `state`.
 * - `@media` rules for non-active devices are listed with their media label but
 *   not evaluated for the current viewport.
 */
export class StyleInspectorModule implements DevtoolsModule {
  readonly id = 'style-inspector';
  readonly title = 'Styles';

  private readonly ctx: ModuleContext;
  private mode: Mode = 'selected';
  private search = '';
  private deadSelectors = new Set<string>();

  private rootEl!: HTMLElement;
  private toolbarEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private countEl!: HTMLElement;
  private refresh!: Debounced<[]>;

  constructor(ctx: ModuleContext) {
    this.ctx = ctx;
  }

  mount(el: HTMLElement): void {
    this.toolbarEl = h('div', { class: 'gjs-dt-toolbar' });
    this.bodyEl = h('div', { class: 'gjs-dt-scroll gjs-dt-si-body' });
    this.rootEl = h('div', { class: 'gjs-dt-si' }, this.toolbarEl, this.bodyEl);
    el.appendChild(this.rootEl);

    this.buildToolbar();
    this.refresh = debounce(() => this.render(), 150);

    const { bridge } = this.ctx;
    for (const ev of [
      'component:selected',
      'component:deselected',
      'style:update',
      'styleable:change',
      'css:add',
      'css:remove',
      'css:update',
      'rule:add',
      'rule:remove',
    ]) {
      bridge.on(ev, () => this.refresh());
    }

    this.render();
  }

  activate(): void {
    this.render();
  }

  destroy(): void {
    this.refresh?.cancel();
    this.deadSelectors.clear();
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /** Switch to "All rules" mode filtered by `name` (called from Managers Overview). */
  filterBySelector(name: string): void {
    this.setMode('all');
    this.search = name;
    if (this.searchInput) this.searchInput.value = name;
    this.render();
  }

  // ── Toolbar ────────────────────────────────────────────────────────────

  private buildToolbar(): void {
    clear(this.toolbarEl);
    const selBtn = h('button', {
      class: 'gjs-dt-btn' + (this.mode === 'selected' ? ' is-active' : ''),
      text: 'Selected',
      dataset: { mode: 'selected' },
      onclick: () => this.setMode('selected'),
    });
    const allBtn = h('button', {
      class: 'gjs-dt-btn' + (this.mode === 'all' ? ' is-active' : ''),
      text: 'All rules',
      dataset: { mode: 'all' },
      onclick: () => this.setMode('all'),
    });
    this.toolbarEl.appendChild(selBtn);
    this.toolbarEl.appendChild(allBtn);

    if (this.mode === 'all') {
      this.searchInput = h('input', {
        class: 'gjs-dt-input',
        placeholder: 'search selector or property…',
        value: this.search,
        style: 'flex:1 1 120px',
      }) as HTMLInputElement;
      this.searchInput.addEventListener('input', () => {
        this.search = this.searchInput.value.trim().toLowerCase();
        this.render();
      });
      this.toolbarEl.appendChild(this.searchInput);
      this.toolbarEl.appendChild(
        h('button', {
          class: 'gjs-dt-btn',
          text: 'Scan dead rules',
          onclick: () => this.scanDeadRules(),
        }),
      );
    }
    this.countEl = h('span', { class: 'gjs-dt-muted' });
    this.toolbarEl.appendChild(this.countEl);
  }

  private setMode(mode: Mode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.buildToolbar();
    this.render();
  }

  // ── Data ───────────────────────────────────────────────────────────────

  private allRules(): CssRule[] {
    try {
      return this.ctx.editor.Css.getAll().map((r: CssRule) => r) as CssRule[];
    } catch {
      return [];
    }
  }

  private baseSelector(rule: CssRule): string {
    try {
      return rule.selectorsToString({ skipState: true });
    } catch {
      return '';
    }
  }

  private fullSelector(rule: CssRule): string {
    try {
      return rule.selectorsToString();
    } catch {
      return '';
    }
  }

  private ruleStyle(rule: CssRule): Record<string, string> {
    try {
      return (rule.getStyle() as Record<string, string>) ?? {};
    } catch {
      return {};
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  private render(): void {
    clear(this.bodyEl);
    if (this.mode === 'selected') this.renderSelected();
    else this.renderAll();
  }

  private renderSelected(): void {
    const comp = this.ctx.editor.getSelected() as Component | undefined;
    const el = comp?.view?.el as HTMLElement | undefined;
    if (!comp || !el) {
      this.countEl.textContent = '';
      this.bodyEl.appendChild(
        h('div', { class: 'gjs-dt-empty', text: 'No component selected' }),
      );
      return;
    }

    // Collect matched rules preserving cascade (collection) order.
    const matched: CssRule[] = [];
    for (const rule of this.allRules()) {
      const base = this.baseSelector(rule);
      if (!base) continue;
      try {
        if (el.matches(base)) matched.push(rule);
      } catch {
        /* invalid selector for matches() — skip */
      }
    }

    this.countEl.textContent = `${matched.length} rule(s)`;
    if (!matched.length) {
      this.bodyEl.appendChild(
        h('div', { class: 'gjs-dt-empty', text: 'No rules match this element' }),
      );
      return;
    }

    // Winning declaration per property = the last matched rule that sets it.
    const winner = new Map<string, number>();
    matched.forEach((rule, idx) => {
      for (const prop of Object.keys(this.ruleStyle(rule))) winner.set(prop, idx);
    });

    matched.forEach((rule, idx) => {
      this.bodyEl.appendChild(this.renderRuleCard(rule, idx, winner));
    });
  }

  private renderRuleCard(
    rule: CssRule,
    idx: number,
    winner: Map<string, number>,
  ): HTMLElement {
    const state = (rule.get('state') as string) || '';
    const media = rule.getAtRule?.() || '';
    const header = h(
      'div',
      { class: 'gjs-dt-si-selhead' },
      h('span', { class: 'gjs-dt-si-selector', text: this.fullSelector(rule) }),
      state ? h('span', { class: 'gjs-dt-badge', text: ':' + state }) : null,
      media ? h('span', { class: 'gjs-dt-badge', text: media }) : null,
    );

    const decls = h('div', { class: 'gjs-dt-si-decls' });
    const style = this.ruleStyle(rule);
    const entries = Object.entries(style);
    if (!entries.length) {
      decls.appendChild(h('div', { class: 'gjs-dt-muted', text: '(empty)' }));
    }
    for (const [prop, value] of entries) {
      const overridden = winner.get(prop) !== undefined && idx < winner.get(prop)!;
      decls.appendChild(this.renderDecl(rule, prop, value, overridden));
    }
    return h('div', { class: 'gjs-dt-si-card' }, header, decls);
  }

  private renderDecl(
    rule: CssRule,
    prop: string,
    value: string,
    overridden: boolean,
  ): HTMLElement {
    const key = h('span', { class: 'gjs-dt-si-prop', text: prop });
    const val = h('span', {
      class: 'gjs-dt-si-value' + (overridden ? ' gjs-dt-si-overridden' : ''),
      text: value,
      title: overridden ? 'Overridden by a later rule' : 'Click to edit',
    });
    // Inline edit on click.
    val.addEventListener('click', () => {
      const input = h('input', {
        class: 'gjs-dt-input',
        value,
        style: 'width:100%',
      }) as HTMLInputElement;
      // Guard so Enter (apply → re-render) doesn't re-trigger via the input's
      // subsequent blur on the now-detached node.
      let settled = false;
      const commit = (write: boolean) => {
        if (settled) return;
        settled = true;
        if (write) {
          const next = input.value.trim();
          try {
            rule.setStyle({ ...this.ruleStyle(rule), [prop]: next });
          } catch {
            /* ignore invalid */
          }
        }
        this.render();
      };
      input.addEventListener('blur', () => commit(true));
      input.addEventListener('keydown', (e) => {
        const key = (e as KeyboardEvent).key;
        if (key === 'Enter') {
          e.preventDefault();
          commit(true);
        } else if (key === 'Escape') {
          e.preventDefault();
          commit(false);
        }
      });
      val.replaceWith(input);
      input.focus();
      input.select();
    });
    return h(
      'div',
      { class: 'gjs-dt-si-decl' },
      key,
      h('span', { class: 'gjs-dt-si-colon', text: ': ' }),
      val,
    );
  }

  private renderAll(): void {
    const rules = this.allRules();
    const q = this.search;
    const filtered = rules.filter((rule) => {
      if (!q) return true;
      const sel = this.fullSelector(rule).toLowerCase();
      if (sel.includes(q)) return true;
      return Object.keys(this.ruleStyle(rule)).some((p) =>
        p.toLowerCase().includes(q),
      );
    });

    this.countEl.textContent = `${filtered.length}/${rules.length} rule(s)`;
    if (!filtered.length) {
      this.bodyEl.appendChild(
        h('div', { class: 'gjs-dt-empty', text: 'No rules' }),
      );
      return;
    }

    for (const rule of filtered) {
      const base = this.baseSelector(rule);
      const dead = this.deadSelectors.has(base);
      const media = rule.getAtRule?.() || '';
      const style = this.ruleStyle(rule);
      const summary = Object.entries(style)
        .map(([p, v]) => `${p}: ${v}`)
        .join('; ');
      const row = h(
        'div',
        { class: 'gjs-dt-si-allrow' + (dead ? ' gjs-dt-si-dead' : '') },
        h(
          'div',
          { class: 'gjs-dt-si-selhead' },
          h('span', { class: 'gjs-dt-si-selector', text: this.fullSelector(rule) }),
          media ? h('span', { class: 'gjs-dt-badge', text: media }) : null,
          dead ? h('span', { class: 'gjs-dt-badge gjs-dt-si-deadbadge', text: 'dead' }) : null,
        ),
        h('div', { class: 'gjs-dt-si-summary gjs-dt-muted', text: summary }),
      );
      this.bodyEl.appendChild(row);
    }
  }

  private scanDeadRules(): void {
    this.deadSelectors.clear();
    let doc: Document | undefined;
    try {
      doc = this.ctx.editor.Canvas.getDocument() as Document;
    } catch {
      doc = undefined;
    }
    if (!doc) return;
    for (const rule of this.allRules()) {
      const base = this.baseSelector(rule);
      if (!base) continue;
      try {
        if (!doc.querySelector(base)) this.deadSelectors.add(base);
      } catch {
        /* invalid selector — not counted as dead */
      }
    }
    this.render();
  }
}
