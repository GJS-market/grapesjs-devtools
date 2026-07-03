import type { DevtoolsModule, ModuleContext, ModuleFactory } from '../types';

interface Entry {
  factory: ModuleFactory;
  instance?: DevtoolsModule;
  container?: HTMLElement;
  mounted: boolean;
}

/**
 * Owns the module instances, mounts them lazily on first tab open, and drives
 * the `activate` / `deactivate` lifecycle on tab switches.
 */
export class ModuleRegistry {
  private readonly ctx: ModuleContext;
  private readonly entries = new Map<string, Entry>();
  private readonly order: string[] = [];
  private activeId: string | null = null;

  /** Set by the panel so modules can request a tab switch via `ctx.selectModule`. */
  requestTab?: (id: string) => void;

  constructor(ctx: Omit<ModuleContext, 'getModule' | 'selectModule'>) {
    // Provide getModule / selectModule bound to this registry.
    this.ctx = {
      ...ctx,
      getModule: (id) => this.getInstance(id),
      selectModule: (id) => this.requestTab?.(id),
    };
  }

  /** Register a module factory under `id`. Instances are created lazily. */
  register(id: string, factory: ModuleFactory): void {
    if (this.entries.has(id)) return;
    this.entries.set(id, { factory, mounted: false });
    this.order.push(id);
  }

  /** Ordered list of registered module ids. */
  ids(): string[] {
    return [...this.order];
  }

  /** Title of a module without forcing it to mount. */
  titleOf(id: string): string {
    return this.ensureInstance(id)?.title ?? id;
  }

  /** Currently active module id, if any. */
  get active(): string | null {
    return this.activeId;
  }

  /**
   * Show the module `id` inside `contentEl`, deactivating the previous one.
   * Mounts lazily on first show.
   */
  show(id: string, contentEl: HTMLElement): void {
    if (!this.entries.has(id) || this.activeId === id) return;

    // Deactivate current.
    if (this.activeId) {
      const cur = this.entries.get(this.activeId);
      cur?.instance?.deactivate?.();
      if (cur?.container) cur.container.style.display = 'none';
    }

    const entry = this.entries.get(id)!;
    const instance = this.ensureInstance(id);
    if (!instance) return;

    if (!entry.mounted) {
      const container = document.createElement('div');
      container.className = 'gjs-dt-module';
      container.dataset.module = id;
      contentEl.appendChild(container);
      entry.container = container;
      instance.mount(container);
      entry.mounted = true;
    }
    if (entry.container) entry.container.style.display = '';
    instance.activate?.();
    this.activeId = id;
  }

  /** Retrieve a mounted (or at least instantiated) module instance. */
  getInstance(id: string): DevtoolsModule | undefined {
    return this.ensureInstance(id);
  }

  private ensureInstance(id: string): DevtoolsModule | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (!entry.instance) entry.instance = entry.factory(this.ctx);
    return entry.instance;
  }

  /** Destroy every instantiated module and reset state. */
  destroyAll(): void {
    if (this.activeId) {
      this.entries.get(this.activeId)?.instance?.deactivate?.();
    }
    for (const entry of this.entries.values()) {
      try {
        entry.instance?.destroy?.();
      } catch {
        /* keep tearing down the rest */
      }
      entry.mounted = false;
      entry.container = undefined;
      entry.instance = undefined;
    }
    this.activeId = null;
  }
}
