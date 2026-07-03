import type { Component } from 'grapesjs';
import type { DevtoolsModule, ModuleContext } from '../../types';
import { h, clear, copyText } from '../../utils/dom';
import { renderJson } from '../../utils/json-viewer';
import { debounce, type Debounced } from '../../utils/debounce';
import { CanvasHighlight } from './CanvasHighlight';

interface NodeRef {
  comp: Component;
  wrapper: HTMLElement;
  row: HTMLElement;
  childrenEl: HTMLElement;
  rendered: boolean;
}

/**
 * Component Inspector — a live component tree on the left, details of the
 * selected component on the right, breadcrumbs on top.
 *
 * Public API (usable by other modules via `ctx.getModule`):
 * - {@link ComponentInspectorModule.revealComponent}
 * - {@link ComponentInspectorModule.getSelected}
 */
export class ComponentInspectorModule implements DevtoolsModule {
  readonly id = 'component-inspector';
  readonly title = 'Components';

  private readonly ctx: ModuleContext;
  private readonly highlight: CanvasHighlight;
  private readonly nodes = new Map<string, NodeRef>();
  private readonly expanded = new Set<string>();

  private crumbsEl!: HTMLElement;
  private treeEl!: HTMLElement;
  private detailsEl!: HTMLElement;
  private active = false;

  private refresh!: Debounced<[]>;

  constructor(ctx: ModuleContext) {
    this.ctx = ctx;
    this.highlight = new CanvasHighlight(ctx.editor);
  }

  mount(el: HTMLElement): void {
    this.crumbsEl = h('div', { class: 'gjs-dt-ci-crumbs' });
    this.treeEl = h('div', { class: 'gjs-dt-ci-tree' });
    this.detailsEl = h('div', {
      class: 'gjs-dt-ci-details',
    });
    this.detailsEl.appendChild(
      h('div', { class: 'gjs-dt-empty', text: 'No component selected' }),
    );

    el.appendChild(
      h(
        'div',
        { class: 'gjs-dt-ci' },
        this.crumbsEl,
        h('div', { class: 'gjs-dt-ci-body' }, this.treeEl, this.detailsEl),
      ),
    );

    this.refresh = debounce(() => this.rebuildTree(), 100);

    const { bridge } = this.ctx;
    bridge.on('component:add', () => this.refresh());
    bridge.on('component:remove', () => this.refresh());
    // High-frequency: patch just the affected row instead of a full rebuild.
    bridge.on('component:update', (comp: Component) =>
      this.patchNode(comp),
    );
    bridge.on('component:selected', (comp: Component) =>
      this.onSelected(comp),
    );
    // Snapshot restore (from snapshots module) — rebuild everything.
    bridge.on('devtools:snapshot:restored', () => this.refresh());

    this.rebuildTree();
    const sel = this.ctx.editor.getSelected();
    if (sel) this.onSelected(sel as Component);
  }

  activate(): void {
    this.active = true;
    this.rebuildTree();
    const sel = this.ctx.editor.getSelected();
    if (sel) this.onSelected(sel as Component);
  }

  deactivate(): void {
    this.active = false;
    this.highlight.hide();
  }

  destroy(): void {
    this.refresh?.cancel();
    this.highlight.destroy();
    this.nodes.clear();
    this.expanded.clear();
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /** Currently selected component, or null. */
  getSelected(): Component | null {
    return (this.ctx.editor.getSelected() as Component) ?? null;
  }

  /**
   * Expand the tree down to the component with `cid`, scroll it into view and
   * highlight it. Selects it in the editor too.
   */
  revealComponent(cid: string): void {
    const comp = this.findByCid(this.ctx.editor.getWrapper() as Component, cid);
    if (!comp) return;
    this.expandAncestors(comp);
    this.rebuildTree();
    this.ctx.editor.select(comp);
    const ref = this.nodes.get(cid);
    ref?.row.scrollIntoView({ block: 'nearest' });
  }

  // ── Tree rendering ─────────────────────────────────────────────────────

  private rebuildTree(): void {
    const scrollTop = this.treeEl.scrollTop;
    clear(this.treeEl);
    this.nodes.clear();
    const wrapper = this.ctx.editor.getWrapper() as Component | undefined;
    if (!wrapper) {
      this.treeEl.appendChild(
        h('div', { class: 'gjs-dt-empty', text: 'No wrapper' }),
      );
      return;
    }
    // Wrapper root is expanded by default.
    this.expanded.add(this.cidOf(wrapper));
    this.treeEl.appendChild(this.renderNode(wrapper));
    this.markSelected(this.getSelected());
    this.treeEl.scrollTop = scrollTop;
  }

  private renderNode(comp: Component): HTMLElement {
    const cid = this.cidOf(comp);
    const kids = comp.components();
    const hasKids = kids.length > 0;
    const isOpen = this.expanded.has(cid);

    const toggle = h('span', {
      class: 'gjs-dt-node-toggle',
      text: hasKids ? (isOpen ? '▾' : '▸') : '',
    });
    const row = h(
      'div',
      { class: 'gjs-dt-node-row', dataset: { cid } },
      toggle,
      h('span', { class: 'gjs-dt-node-icon', text: this.iconFor(comp) }),
      ...this.rowLabel(comp),
    );

    const childrenEl = h('div', {
      class: 'gjs-dt-node-children',
      style: isOpen ? '' : 'display:none',
    });

    const ref: NodeRef = { comp, wrapper: row, row, childrenEl, rendered: false };
    this.nodes.set(cid, ref);

    // Toggle expand/collapse.
    if (hasKids) {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleNode(cid);
      });
    }
    // Select on row click.
    row.addEventListener('click', () => {
      this.ctx.editor.select(comp);
      comp.view?.el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    // Hover highlight in canvas.
    row.addEventListener('mouseenter', () => {
      if (this.active) this.highlight.show(comp.view?.el as HTMLElement);
    });
    row.addEventListener('mouseleave', () => this.highlight.hide());

    const wrap = h('div', {}, row, childrenEl);
    if (isOpen && hasKids) this.renderChildren(ref);
    return wrap;
  }

  private renderChildren(ref: NodeRef): void {
    if (ref.rendered) return;
    ref.rendered = true;
    const kids = ref.comp.components();
    for (let i = 0; i < kids.length; i++) {
      const child = kids.at(i) as Component;
      ref.childrenEl.appendChild(this.renderNode(child));
    }
  }

  private toggleNode(cid: string): void {
    const ref = this.nodes.get(cid);
    if (!ref) return;
    if (this.expanded.has(cid)) {
      this.expanded.delete(cid);
      ref.childrenEl.style.display = 'none';
      ref.row.querySelector('.gjs-dt-node-toggle')!.textContent = '▸';
    } else {
      this.expanded.add(cid);
      this.renderChildren(ref);
      ref.childrenEl.style.display = '';
      ref.row.querySelector('.gjs-dt-node-toggle')!.textContent = '▾';
    }
  }

  /** Patch a single node's label in place (fast path for component:update). */
  private patchNode(comp: Component): void {
    const ref = this.nodes.get(this.cidOf(comp));
    if (!ref) return;
    // Rebuild only the label spans of the row.
    const keep = ref.row.querySelectorAll(
      '.gjs-dt-node-toggle, .gjs-dt-node-icon',
    );
    clear(ref.row);
    ref.row.appendChild(keep[0]);
    ref.row.appendChild(keep[1]);
    for (const span of this.rowLabel(comp)) ref.row.appendChild(span);
    // If this component is selected, refresh details too.
    if (this.getSelected() === comp) this.renderDetails(comp);
  }

  private rowLabel(comp: Component): HTMLElement[] {
    const out: HTMLElement[] = [];
    const tag =
      (comp.get('type') as string) ||
      (comp.get('tagName') as string) ||
      'component';
    out.push(h('span', { class: 'gjs-dt-node-tag', text: tag }));
    const cls = comp.getClasses?.() ?? [];
    if (cls.length) {
      out.push(h('span', { class: 'gjs-dt-node-cls', text: '.' + cls[0] }));
    }
    const id = comp.getId?.();
    if (id) out.push(h('span', { class: 'gjs-dt-node-id', text: '#' + id }));
    return out;
  }

  private iconFor(comp: Component): string {
    const type = (comp.get('type') as string) || (comp.get('tagName') as string);
    switch (type) {
      case 'text':
      case 'textnode':
        return '¶';
      case 'image':
        return '🖼';
      case 'link':
        return '🔗';
      case 'wrapper':
        return '▣';
      case 'video':
        return '▶';
      default:
        return '◻';
    }
  }

  // ── Selection ──────────────────────────────────────────────────────────

  private onSelected(comp: Component): void {
    if (!comp) return;
    this.expandAncestors(comp);
    // Ensure the node exists in the DOM (ancestors just expanded).
    if (!this.nodes.has(this.cidOf(comp))) this.rebuildTree();
    this.markSelected(comp);
    this.renderDetails(comp);
    const ref = this.nodes.get(this.cidOf(comp));
    ref?.row.scrollIntoView({ block: 'nearest' });
    this.renderCrumbs(comp);
  }

  private markSelected(comp: Component | null): void {
    for (const ref of this.nodes.values()) {
      ref.row.classList.remove('is-selected');
    }
    if (comp) {
      this.nodes.get(this.cidOf(comp))?.row.classList.add('is-selected');
    }
  }

  private expandAncestors(comp: Component): void {
    let p = comp.parent() as Component | undefined;
    while (p) {
      this.expanded.add(this.cidOf(p));
      p = p.parent() as Component | undefined;
    }
  }

  // ── Breadcrumbs ────────────────────────────────────────────────────────

  private renderCrumbs(comp: Component): void {
    clear(this.crumbsEl);
    const chain: Component[] = [];
    let c: Component | undefined = comp;
    while (c) {
      chain.unshift(c);
      c = c.parent() as Component | undefined;
    }
    chain.forEach((node, i) => {
      if (i > 0) {
        this.crumbsEl.appendChild(
          h('span', { class: 'gjs-dt-crumb-sep', text: ' › ' }),
        );
      }
      const label =
        (node.get('type') as string) ||
        (node.get('tagName') as string) ||
        'component';
      this.crumbsEl.appendChild(
        h('span', {
          class: 'gjs-dt-crumb',
          text: label,
          onclick: () => this.ctx.editor.select(node),
        }),
      );
    });
    this.crumbsEl.appendChild(
      h('button', {
        class: 'gjs-dt-btn',
        text: 'Copy JSON',
        style: 'margin-left:auto',
        onclick: () =>
          copyText(JSON.stringify(comp.toJSON(), null, 2)),
      }),
    );
  }

  // ── Details ────────────────────────────────────────────────────────────

  private renderDetails(comp: Component): void {
    clear(this.detailsEl);
    this.detailsEl.appendChild(this.attributesSection(comp));
    this.detailsEl.appendChild(this.classesSection(comp));
    this.detailsEl.appendChild(this.traitsSection(comp));
    this.detailsEl.appendChild(this.propsSection(comp));
    this.detailsEl.appendChild(this.stylesSection(comp));
  }

  private section(title: string, body: Node): HTMLElement {
    return h(
      'div',
      { class: 'gjs-dt-section' },
      h('h4', { text: title }),
      body,
    );
  }

  private attributesSection(comp: Component): HTMLElement {
    const attrs = comp.getAttributes?.() ?? {};
    const grid = h('div', { class: 'gjs-dt-kv' });
    const entries = Object.entries(attrs);
    if (!entries.length) {
      grid.appendChild(h('div', { class: 'gjs-dt-muted', text: '—' }));
    }
    for (const [key, value] of entries) {
      grid.appendChild(h('span', { class: 'gjs-dt-kv-key', text: key }));
      const input = h('input', {
        class: 'gjs-dt-input gjs-dt-kv-val',
        value: value == null ? '' : String(value),
      });
      const apply = () => comp.addAttributes({ [key]: input.value });
      input.addEventListener('blur', apply);
      input.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') {
          apply();
          input.blur();
        }
      });
      grid.appendChild(input);
    }
    return this.section('Attributes', grid);
  }

  private classesSection(comp: Component): HTMLElement {
    const cls = comp.getClasses?.() ?? [];
    const body = cls.length
      ? h(
          'div',
          {},
          ...cls.map((c: string) =>
            h('span', { class: 'gjs-dt-badge', text: c }),
          ),
        )
      : h('div', { class: 'gjs-dt-muted', text: '—' });
    return this.section('Classes', body);
  }

  private traitsSection(comp: Component): HTMLElement {
    const traits = comp.getTraits?.() ?? [];
    const grid = h('div', { class: 'gjs-dt-kv' });
    if (!traits.length) {
      grid.appendChild(h('div', { class: 'gjs-dt-muted', text: '—' }));
    }
    for (const trait of traits) {
      const name =
        (trait.get('label') as string) || (trait.get('name') as string) || '';
      const value = trait.getValue ? trait.getValue() : trait.get('value');
      grid.appendChild(h('span', { class: 'gjs-dt-kv-key', text: name }));
      const input = h('input', {
        class: 'gjs-dt-input gjs-dt-kv-val',
        value: value == null ? '' : String(value),
      });
      const apply = () => {
        if (typeof trait.setValue === 'function') trait.setValue(input.value);
        else trait.set('value', input.value);
      };
      input.addEventListener('blur', apply);
      input.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') {
          apply();
          input.blur();
        }
      });
      grid.appendChild(input);
    }
    return this.section('Traits', grid);
  }

  private propsSection(comp: Component): HTMLElement {
    let props: unknown = {};
    try {
      props =
        typeof (comp as unknown as { props?: () => unknown }).props ===
        'function'
          ? (comp as unknown as { props: () => unknown }).props()
          : {};
    } catch {
      props = {};
    }
    return this.section('Props', renderJson(props, { expandDepth: 0 }));
  }

  private stylesSection(comp: Component): HTMLElement {
    let style: Record<string, unknown> = {};
    try {
      style = (comp.getStyle?.() as Record<string, unknown>) ?? {};
    } catch {
      style = {};
    }
    const entries = Object.entries(style);
    const grid = h('div', { class: 'gjs-dt-kv' });
    if (!entries.length) {
      grid.appendChild(h('div', { class: 'gjs-dt-muted', text: '—' }));
    }
    for (const [key, value] of entries) {
      grid.appendChild(h('span', { class: 'gjs-dt-kv-key', text: key }));
      grid.appendChild(
        h('span', { class: 'gjs-dt-mono', text: String(value) }),
      );
    }
    return this.section('Styles (inline)', grid);
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private cidOf(comp: Component): string {
    return (comp as unknown as { cid: string }).cid;
  }

  private findByCid(root: Component, cid: string): Component | undefined {
    if (this.cidOf(root) === cid) return root;
    const kids = root.components();
    for (let i = 0; i < kids.length; i++) {
      const found = this.findByCid(kids.at(i) as Component, cid);
      if (found) return found;
    }
    return undefined;
  }
}
