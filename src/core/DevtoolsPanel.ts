import type { Editor } from 'grapesjs';
import type { ResolvedOptions, ModuleFactory, PanelPosition } from '../types';
import { EditorBridge } from './EditorBridge';
import { ModuleRegistry } from './ModuleRegistry';
import { h, clear } from '../utils/dom';

const LS_KEY = 'gjs-devtools-panel';

interface PanelState {
  width: number;
  height: number;
  activeTab?: string;
  position?: PanelPosition;
}

/**
 * The docked devtools container: tab strip, content area, resize handle and
 * close button. Rendered as a `position: fixed` overlay appended to
 * `document.body` — it never enters the canvas iframe and never mutates the
 * editor's own layout.
 */
export class DevtoolsPanel {
  readonly bridge: EditorBridge;
  readonly registry: ModuleRegistry;

  private readonly editor: Editor;
  private readonly opts: ResolvedOptions;
  private root!: HTMLElement;
  private tabsEl!: HTMLElement;
  private contentEl!: HTMLElement;
  private state: PanelState;
  private position: PanelPosition;
  private visible = false;
  private built = false;
  private mql?: MediaQueryList;
  private onThemeChange?: (e: MediaQueryListEvent) => void;

  constructor(editor: Editor, opts: ResolvedOptions) {
    this.editor = editor;
    this.opts = opts;
    this.bridge = new EditorBridge(editor);
    this.registry = new ModuleRegistry({
      editor,
      bridge: this.bridge,
      options: opts,
    });
    this.state = {
      width: opts.panelWidth,
      height: opts.panelHeight,
      ...this.loadState(),
    };
    // Persisted position wins over the option so the user's choice sticks.
    this.position = this.state.position ?? opts.position;
  }

  /** Register a module factory. Call before `show()`. */
  registerModule(id: string, factory: ModuleFactory): void {
    this.registry.register(id, factory);
  }

  /** Whether the panel is currently visible. */
  get isVisible(): boolean {
    return this.visible;
  }

  /** Show the panel, building the DOM on first call. */
  show(): void {
    if (!this.built) this.build();
    this.visible = true;
    this.root.classList.remove('gjs-dt-hidden');
    // Activate the last / first tab.
    const first =
      this.state.activeTab && this.registry.ids().includes(this.state.activeTab)
        ? this.state.activeTab
        : this.registry.ids()[0];
    if (first) this.selectTab(first);
  }

  /** Hide the panel (kept in DOM; state preserved). */
  hide(): void {
    if (!this.built) return;
    this.visible = false;
    this.root.classList.add('gjs-dt-hidden');
  }

  /** Fully tear down: destroy modules, remove listeners, remove DOM. */
  destroy(): void {
    this.registry.destroyAll();
    this.bridge.disposeAll();
    if (this.mql && this.onThemeChange) {
      this.mql.removeEventListener('change', this.onThemeChange);
    }
    this.root?.remove();
    this.built = false;
    this.visible = false;
  }

  // ── build ────────────────────────────────────────────────────────────

  private build(): void {
    this.root = h('div', {
      class: `gjs-dt gjs-dt-pos-${this.position}`,
    });
    this.applyTheme();
    this.applySize();

    const resize = h('div', { class: 'gjs-dt-resize' });
    resize.addEventListener('mousedown', (e) => this.startResize(e));

    this.tabsEl = h('div', { class: 'gjs-dt-tabs' });

    // Dock switcher: left / bottom / right.
    const dock = h('div', { class: 'gjs-dt-dock' });
    const docks: [PanelPosition, string, string][] = [
      ['left', '⇤', 'Dock left'],
      ['bottom', '⇩', 'Dock bottom'],
      ['right', '⇥', 'Dock right'],
    ];
    for (const [pos, glyph, title] of docks) {
      dock.appendChild(
        h('button', {
          class: 'gjs-dt-dock-btn',
          text: glyph,
          title,
          dataset: { pos },
          onclick: () => this.setPosition(pos),
        }),
      );
    }

    // Persistent help link — GrapesJS development services by gjs.market.
    const helpLink = h('a', {
      class: 'gjs-dt-help',
      text: '?',
      href: 'https://gjs.market/services',
      title: 'Need help? GrapesJS development services (gjs.market)',
      attrs: { target: '_blank', rel: 'noopener noreferrer' },
    });

    const closeBtn = h('button', {
      class: 'gjs-dt-close',
      title: 'Close (toggle command)',
      text: '×',
      onclick: () => this.editor.stopCommand('devtools:toggle'),
    });
    const header = h(
      'div',
      { class: 'gjs-dt-header' },
      this.tabsEl,
      h('div', { class: 'gjs-dt-header-actions' }, dock, helpLink, closeBtn),
    );

    this.contentEl = h('div', { class: 'gjs-dt-content' });

    this.root.appendChild(resize);
    this.root.appendChild(header);
    this.root.appendChild(this.contentEl);
    document.body.appendChild(this.root);

    // Let modules request a tab switch (e.g. Managers → Style Inspector).
    this.registry.requestTab = (id) => this.selectTab(id);

    this.buildTabs();
    this.markDock();
    this.built = true;
  }

  private buildTabs(): void {
    clear(this.tabsEl);
    for (const id of this.registry.ids()) {
      const tab = h('button', {
        class: 'gjs-dt-tab',
        text: this.registry.titleOf(id),
        dataset: { tab: id },
        onclick: () => this.selectTab(id),
      });
      this.tabsEl.appendChild(tab);
    }
  }

  private selectTab(id: string): void {
    this.registry.show(id, this.contentEl);
    for (const el of Array.from(
      this.tabsEl.querySelectorAll<HTMLElement>('.gjs-dt-tab'),
    )) {
      el.classList.toggle('is-active', el.dataset.tab === id);
    }
    this.state.activeTab = id;
    this.saveState();
  }

  // ── theme ────────────────────────────────────────────────────────────

  private applyTheme(): void {
    const set = (light: boolean) =>
      this.root.classList.toggle('gjs-dt-light', light);
    if (this.opts.theme === 'light') {
      set(true);
    } else if (this.opts.theme === 'dark') {
      set(false);
    } else {
      // auto — follow the OS and keep following it.
      this.mql = window.matchMedia('(prefers-color-scheme: light)');
      set(this.mql.matches);
      this.onThemeChange = (e) => set(e.matches);
      this.mql.addEventListener('change', this.onThemeChange);
    }
  }

  // ── position / sizing / resize ─────────────────────────────────────────

  /** Change the docking side live (persisted). */
  setPosition(pos: PanelPosition): void {
    if (pos === this.position) return;
    this.root.classList.remove(
      'gjs-dt-pos-right',
      'gjs-dt-pos-left',
      'gjs-dt-pos-bottom',
    );
    this.position = pos;
    this.root.classList.add(`gjs-dt-pos-${pos}`);
    this.applySize();
    this.markDock();
    this.state.position = pos;
    this.saveState();
  }

  private markDock(): void {
    for (const btn of Array.from(
      this.root.querySelectorAll<HTMLElement>('.gjs-dt-dock-btn'),
    )) {
      btn.classList.toggle('is-active', btn.dataset.pos === this.position);
    }
  }

  private applySize(): void {
    const horizontal = this.position === 'right' || this.position === 'left';
    if (horizontal) {
      this.root.style.width = `${this.state.width}px`;
      this.root.style.height = '';
    } else {
      this.root.style.height = `${this.state.height}px`;
      this.root.style.width = '';
    }
  }

  private startResize(e: MouseEvent): void {
    e.preventDefault();
    const pos = this.position;
    // The drag handle sits on the inner edge of the panel: for `right` the
    // panel grows as the pointer moves left; for `left` it grows moving right.
    const horizontal = pos === 'right' || pos === 'left';
    const startPos = horizontal ? e.clientX : e.clientY;
    const startSize = horizontal ? this.state.width : this.state.height;
    const sign = pos === 'right' || pos === 'bottom' ? -1 : 1;

    const move = (ev: MouseEvent) => {
      const cur = horizontal ? ev.clientX : ev.clientY;
      const delta = (cur - startPos) * sign;
      const max = horizontal
        ? window.innerWidth - 100
        : window.innerHeight - 100;
      const next = Math.max(200, Math.min(startSize + delta, max));
      if (horizontal) this.state.width = next;
      else this.state.height = next;
      this.applySize();
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      this.saveState();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  // ── persistence ──────────────────────────────────────────────────────

  private loadState(): Partial<PanelState> {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? (JSON.parse(raw) as Partial<PanelState>) : {};
    } catch {
      return {};
    }
  }

  private saveState(): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.state));
    } catch {
      /* storage may be unavailable / full — non-fatal */
    }
  }
}
