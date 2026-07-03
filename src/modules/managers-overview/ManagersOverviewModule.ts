import type { Component } from 'grapesjs';
import type { DevtoolsModule, ModuleContext } from '../../types';
import { h, clear } from '../../utils/dom';
import { renderJson } from '../../utils/json-viewer';
import { escapeHtml } from '../../utils/format';
import type { StyleInspectorModule } from '../style-inspector/StyleInspectorModule';

interface Section {
  id: string;
  title: string;
  render: (body: HTMLElement) => void;
}

/**
 * Managers Overview — an accordion summarising the editor's internal managers:
 * Blocks, Traits, Selectors, Devices and configured Plugins. Each section
 * lazy-loads its data on first expand and can be refreshed independently.
 */
export class ManagersOverviewModule implements DevtoolsModule {
  readonly id = 'managers-overview';
  readonly title = 'Managers';

  private readonly ctx: ModuleContext;
  private readonly open = new Set<string>();
  private rootEl!: HTMLElement;
  /** Cached component walk, invalidated per full render / refresh. */
  private walkCache: Component[] | null = null;

  constructor(ctx: ModuleContext) {
    this.ctx = ctx;
  }

  mount(el: HTMLElement): void {
    this.rootEl = h('div', { class: 'gjs-dt-scroll gjs-dt-mo' });
    el.appendChild(this.rootEl);
    this.render();
  }

  activate(): void {
    this.walkCache = null;
    this.render();
  }

  destroy(): void {
    this.open.clear();
    this.walkCache = null;
  }

  // ── Accordion ──────────────────────────────────────────────────────────

  private sections(): Section[] {
    return [
      { id: 'blocks', title: 'Blocks', render: (b) => this.renderBlocks(b) },
      { id: 'traits', title: 'Traits', render: (b) => this.renderTraits(b) },
      { id: 'selectors', title: 'Selectors', render: (b) => this.renderSelectors(b) },
      { id: 'devices', title: 'Devices', render: (b) => this.renderDevices(b) },
      { id: 'plugins', title: 'Plugins', render: (b) => this.renderPlugins(b) },
    ];
  }

  private render(): void {
    clear(this.rootEl);
    for (const section of this.sections()) {
      this.rootEl.appendChild(this.renderSection(section));
    }
  }

  private renderSection(section: Section): HTMLElement {
    const isOpen = this.open.has(section.id);
    const body = h('div', {
      class: 'gjs-dt-mo-body',
      style: isOpen ? '' : 'display:none',
    });

    const header = h(
      'div',
      { class: 'gjs-dt-mo-head' },
      h('span', { class: 'gjs-dt-json-toggle', text: isOpen ? '▾' : '▸' }),
      h('span', { class: 'gjs-dt-mo-title', text: section.title }),
      h('button', {
        class: 'gjs-dt-btn gjs-dt-mo-refresh',
        text: '↻',
        title: 'Refresh',
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          this.walkCache = null;
          clear(body);
          section.render(body);
        },
      }),
    );
    header.addEventListener('click', () => {
      const nowOpen = !this.open.has(section.id);
      if (nowOpen) {
        this.open.add(section.id);
        clear(body);
        section.render(body); // lazy load on expand
      } else {
        this.open.delete(section.id);
      }
      body.style.display = nowOpen ? '' : 'none';
      header.querySelector('.gjs-dt-json-toggle')!.textContent = nowOpen ? '▾' : '▸';
    });

    if (isOpen) section.render(body);
    return h('div', { class: 'gjs-dt-mo-section' }, header, body);
  }

  // ── Shared component walk (cached per render) ──────────────────────────

  private walk(): Component[] {
    if (this.walkCache) return this.walkCache;
    const out: Component[] = [];
    const wrapper = this.ctx.editor.getWrapper() as Component | undefined;
    const visit = (c: Component) => {
      out.push(c);
      const kids = c.components();
      for (let i = 0; i < kids.length; i++) visit(kids.at(i) as Component);
    };
    if (wrapper) visit(wrapper);
    this.walkCache = out;
    return out;
  }

  // ── Blocks ─────────────────────────────────────────────────────────────

  private renderBlocks(body: HTMLElement): void {
    let blocks: any[] = [];
    try {
      blocks = this.ctx.editor.Blocks.getAll().map((b: any) => b);
    } catch {
      blocks = [];
    }
    const search = h('input', {
      class: 'gjs-dt-input',
      placeholder: 'search id/label…',
      style: 'width:100%',
    }) as HTMLInputElement;
    const list = h('div', {});
    const draw = () => {
      clear(list);
      const q = search.value.trim().toLowerCase();
      const rows = blocks.filter((b) => {
        const id = String(b.getId?.() ?? b.get?.('id') ?? '');
        const label = String(b.get?.('label') ?? '');
        return !q || id.toLowerCase().includes(q) || label.toLowerCase().includes(q);
      });
      if (!rows.length) {
        list.appendChild(h('div', { class: 'gjs-dt-empty', text: 'No blocks' }));
      }
      for (const b of rows) {
        const id = String(b.getId?.() ?? b.get?.('id') ?? '');
        const label = String(b.get?.('label') ?? '');
        const category = this.categoryLabel(b.get?.('category'));
        const hasMedia = !!b.get?.('media');
        const labelEl = h('span', { class: 'gjs-dt-mo-blocklabel' });
        labelEl.innerHTML = escapeHtml(label || id); // labels may contain HTML
        const row = h(
          'div',
          { class: 'gjs-dt-mo-row' },
          h('span', { class: 'gjs-dt-node-id', text: id }),
          labelEl,
          category ? h('span', { class: 'gjs-dt-badge', text: category }) : null,
          hasMedia ? h('span', { class: 'gjs-dt-badge', text: 'media' }) : null,
        );
        const detail = h('div', { style: 'display:none' });
        let open = false;
        row.addEventListener('click', () => {
          open = !open;
          if (open && !detail.childElementCount) {
            detail.appendChild(renderJson(b.get?.('content'), { expandDepth: 1 }));
          }
          detail.style.display = open ? '' : 'none';
        });
        list.appendChild(row);
        list.appendChild(detail);
      }
    };
    search.addEventListener('input', draw);
    body.appendChild(search);
    body.appendChild(list);
    draw();
  }

  private categoryLabel(cat: unknown): string {
    if (!cat) return '';
    if (typeof cat === 'string') return cat;
    const c = cat as { get?: (k: string) => unknown; id?: string };
    return String(c.get?.('label') ?? c.get?.('id') ?? c.id ?? '');
  }

  // ── Traits ─────────────────────────────────────────────────────────────

  private renderTraits(body: HTMLElement): void {
    let types: string[] = [];
    try {
      types = Object.keys(this.ctx.editor.TraitManager.getTypes() as object);
    } catch {
      types = [];
    }
    // Count usage across the project.
    const counts = new Map<string, number>();
    for (const comp of this.walk()) {
      let traits: any[] = [];
      try {
        traits = comp.getTraits?.() ?? [];
      } catch {
        traits = [];
      }
      for (const t of traits) {
        const type = String(t.get?.('type') ?? 'text');
        counts.set(type, (counts.get(type) ?? 0) + 1);
      }
    }
    if (!types.length) {
      body.appendChild(h('div', { class: 'gjs-dt-empty', text: 'No trait types' }));
      return;
    }
    const table = h('table', { class: 'gjs-dt-stats-table' });
    table.appendChild(
      h('tr', {}, h('th', { text: 'Trait type' }), h('th', { text: 'Used by' })),
    );
    for (const type of types.sort()) {
      table.appendChild(
        h(
          'tr',
          {},
          h('td', { text: type }),
          h('td', { text: String(counts.get(type) ?? 0) }),
        ),
      );
    }
    body.appendChild(table);
  }

  // ── Selectors ──────────────────────────────────────────────────────────

  private renderSelectors(body: HTMLElement): void {
    let selectors: any[] = [];
    try {
      selectors = this.ctx.editor.Selectors.getAll().map((s: any) => s);
    } catch {
      selectors = [];
    }
    // Usage counts by class name / id.
    const classCount = new Map<string, number>();
    for (const comp of this.walk()) {
      let classes: string[] = [];
      try {
        classes = comp.getClasses?.() ?? [];
      } catch {
        classes = [];
      }
      for (const c of classes) classCount.set(c, (classCount.get(c) ?? 0) + 1);
      const id = comp.getId?.();
      if (id) classCount.set('#' + id, (classCount.get('#' + id) ?? 0) + 1);
    }

    if (!selectors.length) {
      body.appendChild(h('div', { class: 'gjs-dt-empty', text: 'No selectors' }));
      return;
    }
    const table = h('table', { class: 'gjs-dt-stats-table' });
    table.appendChild(
      h(
        'tr',
        {},
        h('th', { text: 'Selector' }),
        h('th', { text: 'Type' }),
        h('th', { text: 'Uses' }),
      ),
    );
    for (const sel of selectors) {
      const name = String(sel.getName?.() ?? '');
      const isId = !!sel.isId?.();
      const full = String(sel.getFullName?.() ?? (isId ? '#' + name : '.' + name));
      const protectedFlag = !!sel.get?.('private');
      const uses = classCount.get(isId ? '#' + name : name) ?? 0;
      const nameCell = h('td', {}, h('span', { class: 'gjs-dt-crumb', text: full }));
      nameCell.firstChild!.addEventListener('click', () => this.revealInStyles(full));
      table.appendChild(
        h(
          'tr',
          {},
          nameCell,
          h('td', { text: (isId ? 'id' : 'class') + (protectedFlag ? ' 🔒' : '') }),
          h('td', { text: String(uses) }),
        ),
      );
    }
    body.appendChild(
      h('div', { class: 'gjs-dt-muted', text: 'Click a selector to filter it in Styles.' }),
    );
    body.appendChild(table);
  }

  private revealInStyles(fullName: string): void {
    const si = this.ctx.getModule('style-inspector') as
      | StyleInspectorModule
      | undefined;
    if (!si || typeof si.filterBySelector !== 'function') return;
    this.ctx.selectModule('style-inspector'); // brings the tab forward + mounts
    si.filterBySelector(fullName);
  }

  // ── Devices ────────────────────────────────────────────────────────────

  private renderDevices(body: HTMLElement): void {
    let devices: any[] = [];
    let current = '';
    try {
      devices = this.ctx.editor.Devices.getAll().map((d: any) => d);
      current = String(this.ctx.editor.getDevice() ?? '');
    } catch {
      devices = [];
    }
    if (!devices.length) {
      body.appendChild(h('div', { class: 'gjs-dt-empty', text: 'No devices' }));
      return;
    }
    for (const dev of devices) {
      const name = String(dev.getName?.() ?? dev.get?.('name') ?? '');
      const width = String(dev.get?.('width') ?? '') || 'auto';
      const media = String(dev.getWidthMedia?.() ?? '');
      const isCurrent = name === current;
      const row = h(
        'div',
        { class: 'gjs-dt-mo-row' + (isCurrent ? ' is-selected' : '') },
        h('span', { class: 'gjs-dt-node-tag', text: name || '(default)' }),
        h('span', { class: 'gjs-dt-muted', text: `${width}${media ? ' · ' + media : ''}` }),
        isCurrent ? h('span', { class: 'gjs-dt-badge', text: 'current' }) : null,
      );
      row.addEventListener('click', () => {
        try {
          this.ctx.editor.setDevice(name);
        } catch {
          /* ignore */
        }
        clear(body);
        this.renderDevices(body);
      });
      body.appendChild(row);
    }
  }

  // ── Plugins ────────────────────────────────────────────────────────────

  private renderPlugins(body: HTMLElement): void {
    let config: any = {};
    try {
      config = this.ctx.editor.getConfig();
    } catch {
      config = {};
    }
    const plugins: unknown[] = Array.isArray(config.plugins) ? config.plugins : [];
    const opts = config.pluginsOpts ?? {};

    if (!plugins.length) {
      body.appendChild(h('div', { class: 'gjs-dt-empty', text: 'No plugins configured' }));
    }
    plugins.forEach((plugin, i) => {
      let name: string;
      if (typeof plugin === 'string') name = plugin;
      else name = (plugin as { name?: string }).name || `anonymous #${i}`;
      const detail = h('div', { style: 'display:none' });
      const row = h(
        'div',
        { class: 'gjs-dt-mo-row' },
        h('span', { class: 'gjs-dt-json-toggle', text: '▸' }),
        h('span', { class: 'gjs-dt-node-tag', text: name }),
      );
      let open = false;
      row.addEventListener('click', () => {
        open = !open;
        if (open && !detail.childElementCount) {
          detail.appendChild(renderJson(opts[name] ?? {}, { expandDepth: 1 }));
        }
        detail.style.display = open ? '' : 'none';
        row.querySelector('.gjs-dt-json-toggle')!.textContent = open ? '▾' : '▸';
      });
      body.appendChild(row);
      body.appendChild(detail);
    });
  }
}
