import type { Component } from 'grapesjs';
import type { DevtoolsModule, ModuleContext } from '../../types';
import { h } from '../../utils/dom';
import { rafThrottle, type Debounced } from '../../utils/debounce';
import { CanvasOverlay, type OverlayBox } from './CanvasOverlay';

/**
 * Canvas Tools — overlays drawn above (never inside) the canvas iframe:
 * a highlight mode outlining every component, a box-model view for the
 * selection, a pointer-events killer for the canvas body, and scroll-to-selected.
 *
 * All overlays account for `Canvas.getZoom()` and are removed on
 * `deactivate()` / `destroy()`.
 */
export class CanvasToolsModule implements DevtoolsModule {
  readonly id = 'canvas-tools';
  readonly title = 'Canvas';

  private readonly ctx: ModuleContext;
  private readonly overlay: CanvasOverlay;

  private highlight = false;
  private pointerDisabled = false;
  private active = false;

  private rootEl!: HTMLElement;
  private warnEl!: HTMLElement;
  private redraw!: Debounced<[]>;
  private winCleanup: Array<() => void> = [];

  constructor(ctx: ModuleContext) {
    this.ctx = ctx;
    this.overlay = new CanvasOverlay(ctx.editor);
  }

  mount(el: HTMLElement): void {
    this.redraw = rafThrottle(() => this.drawOverlays());

    const highlightBtn = h('button', {
      class: 'gjs-dt-btn',
      text: 'Highlight all',
      dataset: { toggle: 'highlight' },
      onclick: () => this.toggleHighlight(),
    });
    const pointerBtn = h('button', {
      class: 'gjs-dt-btn',
      text: 'Disable pointer-events',
      dataset: { toggle: 'pointer' },
      onclick: () => this.togglePointer(),
    });
    const scrollBtn = h('button', {
      class: 'gjs-dt-btn',
      text: 'Scroll to selected',
      onclick: () => this.scrollToSelected(),
    });

    this.warnEl = h('div', {
      class: 'gjs-dt-ct-warn',
      style: 'display:none',
      text: '⚠ pointer-events disabled on the canvas body — clicks pass through',
    });

    this.rootEl = h(
      'div',
      { class: 'gjs-dt-ct' },
      h('div', { class: 'gjs-dt-toolbar' }, highlightBtn, pointerBtn, scrollBtn),
      this.warnEl,
      h('div', {
        class: 'gjs-dt-ct-hint gjs-dt-muted',
      }, 'Highlight outlines every component (colour by depth) and shows the box model of the selection. Overlays live above the canvas and never touch the iframe DOM.'),
    );
    el.appendChild(this.rootEl);

    // Redraw overlays on canvas movement and structural/selection changes.
    for (const ev of [
      'canvas:update',
      'component:add',
      'component:remove',
      'component:update',
      'component:selected',
      'change:device',
      'canvas:scroll',
    ]) {
      this.ctx.bridge.on(ev, () => {
        if (this.active && this.highlight) this.redraw();
      });
    }
  }

  activate(): void {
    this.active = true;
    this.bindCanvasScroll();
    if (this.highlight) this.drawOverlays();
  }

  deactivate(): void {
    this.active = false;
    this.overlay.clear();
    this.unbindCanvasScroll();
  }

  destroy(): void {
    this.redraw?.cancel();
    this.overlay.destroy();
    this.unbindCanvasScroll();
    // Restore pointer-events if we left it disabled.
    if (this.pointerDisabled) this.setPointerEvents(true);
  }

  // ── Highlight ──────────────────────────────────────────────────────────

  private toggleHighlight(): void {
    this.highlight = !this.highlight;
    this.setToggleState('highlight', this.highlight);
    if (this.highlight) this.drawOverlays();
    else this.overlay.clear();
  }

  private drawOverlays(): void {
    if (!this.active || !this.highlight) return;
    const boxes: OverlayBox[] = [];
    const wrapper = this.ctx.editor.getWrapper() as Component | undefined;
    const visit = (c: Component, depth: number) => {
      const el = c.view?.el as HTMLElement | undefined;
      if (el) {
        const rect = this.overlay.rectOf(el);
        if (rect) {
          rect.depth = depth;
          rect.label =
            (c.get('type') as string) || (c.get('tagName') as string) || '';
          boxes.push(rect);
        }
      }
      const kids = c.components();
      for (let i = 0; i < kids.length; i++) visit(kids.at(i) as Component, depth + 1);
    };
    // Skip the wrapper itself (depth 0) to avoid a full-canvas box; start at children.
    if (wrapper) {
      const kids = wrapper.components();
      for (let i = 0; i < kids.length; i++) visit(kids.at(i) as Component, 0);
    }
    this.overlay.draw(boxes);
    this.drawBoxModel();
  }

  /** Overlay translucent margin/padding/content regions for the selection. */
  private drawBoxModel(): void {
    const comp = this.ctx.editor.getSelected() as Component | undefined;
    const el = comp?.view?.el as HTMLElement | undefined;
    if (!el) return;
    const rect = this.overlay.rectOf(el);
    if (!rect) return;

    let off: Record<string, number | undefined> | null = null;
    try {
      off = this.ctx.editor.Canvas.getElementOffsets(el) as Record<
        string,
        number | undefined
      >;
    } catch {
      off = null;
    }
    const zoom = (this.ctx.editor.Canvas.getZoom?.() ?? 100) / 100 || 1;
    if (off) {
      const n = (k: string) => (off![k] ?? 0) * zoom;
      // Margin box (outer).
      this.overlay.drawRegion(
        {
          top: rect.top - n('marginTop'),
          left: rect.left - n('marginLeft'),
          width: rect.width + n('marginLeft') + n('marginRight'),
          height: rect.height + n('marginTop') + n('marginBottom'),
        },
        'gjs-dt-ov-margin',
      );
      // Content box (inner, inside padding).
      this.overlay.drawRegion(
        {
          top: rect.top + n('paddingTop'),
          left: rect.left + n('paddingLeft'),
          width: rect.width - n('paddingLeft') - n('paddingRight'),
          height: rect.height - n('paddingTop') - n('paddingBottom'),
        },
        'gjs-dt-ov-content',
      );
    }
    // Size plaque on the border box.
    this.overlay.drawRegion(
      rect,
      'gjs-dt-ov-padding',
      `${Math.round(rect.width)}×${Math.round(rect.height)}`,
    );
  }

  // ── Pointer-events toggle ──────────────────────────────────────────────

  private togglePointer(): void {
    this.pointerDisabled = !this.pointerDisabled;
    this.setPointerEvents(!this.pointerDisabled);
    this.setToggleState('pointer', this.pointerDisabled);
    this.warnEl.style.display = this.pointerDisabled ? '' : 'none';
  }

  private setPointerEvents(enabled: boolean): void {
    try {
      const body = this.ctx.editor.Canvas.getBody();
      if (body) body.style.pointerEvents = enabled ? '' : 'none';
    } catch {
      /* canvas not ready — ignore */
    }
  }

  // ── Scroll to selected ─────────────────────────────────────────────────

  private scrollToSelected(): void {
    const comp = this.ctx.editor.getSelected();
    if (!comp) return;
    try {
      this.ctx.editor.Canvas.scrollTo(comp);
    } catch {
      try {
        (comp as Component).view?.el?.scrollIntoView({ block: 'center' });
      } catch {
        /* ignore */
      }
    }
  }

  // ── Canvas scroll binding (for overlay tracking) ───────────────────────

  private bindCanvasScroll(): void {
    this.unbindCanvasScroll();
    const handler = () => {
      if (this.active && this.highlight) this.redraw();
    };
    try {
      const win = this.ctx.editor.Canvas.getWindow();
      if (win) {
        win.addEventListener('scroll', handler, true);
        this.winCleanup.push(() => win.removeEventListener('scroll', handler, true));
      }
    } catch {
      /* ignore */
    }
    window.addEventListener('resize', handler);
    this.winCleanup.push(() => window.removeEventListener('resize', handler));
  }

  private unbindCanvasScroll(): void {
    for (const fn of this.winCleanup) fn();
    this.winCleanup = [];
  }

  // ── UI helpers ─────────────────────────────────────────────────────────

  private setToggleState(toggle: string, on: boolean): void {
    const btn = this.rootEl.querySelector<HTMLElement>(
      `[data-toggle="${toggle}"]`,
    );
    btn?.classList.toggle('is-active', on);
  }
}
