/** A description of a picked editor UI element, used as AI context. */
export interface PickedElement {
  tag: string;
  id: string;
  classes: string[];
  /** Best-effort guess of which GrapesJS area the element belongs to. */
  area: string;
  /** A short, truncated outerHTML snippet. */
  html: string;
}

/** Map of GrapesJS root class → human label, checked against ancestors. */
const AREAS: [string, string][] = [
  ['gjs-pn-panels', 'editor panels (Panels manager)'],
  ['gjs-pn-panel', 'a toolbar panel (Panels manager)'],
  ['gjs-blocks-cs', 'the Blocks manager'],
  ['gjs-block', 'a block (Blocks manager)'],
  ['gjs-layer', 'the Layers manager'],
  ['gjs-sm-sectors', 'the Style Manager'],
  ['gjs-clm-tags', 'the Selector Manager'],
  ['gjs-trt-traits', 'the Trait Manager'],
  ['gjs-cv-canvas', 'the canvas area'],
  ['gjs-toolbar', 'the component toolbar'],
];

/**
 * Lets the user click any part of the editor chrome (panels, buttons, managers)
 * to capture it as context for an AI question. Draws a hover outline over the
 * top document (never inside the canvas iframe) and resolves on click.
 *
 * The plugin's own panel (`.gjs-dt`) is excluded so you can operate the picker.
 */
export class ElementPicker {
  private overlay: HTMLElement | null = null;
  private onMove?: (e: MouseEvent) => void;
  private onClick?: (e: MouseEvent) => void;
  private onKey?: (e: KeyboardEvent) => void;
  private active = false;

  /** Begin picking. Resolves with the element, or null if cancelled (Esc). */
  pick(): Promise<PickedElement | null> {
    if (this.active) this.stop();
    this.active = true;
    document.body.classList.add('gjs-dt-picking');

    return new Promise((resolve) => {
      const finish = (result: PickedElement | null) => {
        this.stop();
        resolve(result);
      };

      this.onMove = (e) => {
        const el = this.targetAt(e);
        if (el) this.drawOutline(el);
        else this.hideOutline();
      };
      this.onClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const el = this.targetAt(e);
        finish(el ? this.describe(el) : null);
      };
      this.onKey = (e) => {
        if (e.key === 'Escape') finish(null);
      };

      document.addEventListener('mousemove', this.onMove, true);
      document.addEventListener('click', this.onClick, true);
      document.addEventListener('keydown', this.onKey, true);
    });
  }

  /** Whether a pick is in progress. */
  get isActive(): boolean {
    return this.active;
  }

  destroy(): void {
    this.stop();
  }

  private stop(): void {
    this.active = false;
    document.body.classList.remove('gjs-dt-picking');
    if (this.onMove) document.removeEventListener('mousemove', this.onMove, true);
    if (this.onClick) document.removeEventListener('click', this.onClick, true);
    if (this.onKey) document.removeEventListener('keydown', this.onKey, true);
    this.onMove = this.onClick = undefined;
    this.onKey = undefined;
    this.hideOutline();
  }

  /** The element under the pointer, unless it's inside our own panel. */
  private targetAt(e: MouseEvent): HTMLElement | null {
    const el = e.target as HTMLElement | null;
    if (!el) return null;
    if (el.closest('.gjs-dt')) return null; // ignore our own panel / overlay
    return el;
  }

  private ensureOverlay(): HTMLElement {
    if (!this.overlay) {
      this.overlay = document.createElement('div');
      this.overlay.className = 'gjs-dt gjs-dt-pick-overlay';
      document.body.appendChild(this.overlay);
    }
    return this.overlay;
  }

  private drawOutline(el: HTMLElement): void {
    const r = el.getBoundingClientRect();
    const o = this.ensureOverlay();
    o.style.display = '';
    o.style.top = `${r.top}px`;
    o.style.left = `${r.left}px`;
    o.style.width = `${r.width}px`;
    o.style.height = `${r.height}px`;
  }

  private hideOutline(): void {
    if (this.overlay) this.overlay.style.display = 'none';
  }

  private describe(el: HTMLElement): PickedElement {
    const classes =
      typeof el.className === 'string'
        ? el.className.trim().split(/\s+/).filter(Boolean)
        : [];
    let area = 'the editor UI';
    for (const [cls, label] of AREAS) {
      if (el.closest(`.${cls}`)) {
        area = label;
        break;
      }
    }
    let html = '';
    try {
      html = el.outerHTML.slice(0, 400);
    } catch {
      html = `<${el.tagName.toLowerCase()}>`;
    }
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      classes,
      area,
      html,
    };
  }
}
