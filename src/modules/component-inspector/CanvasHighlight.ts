import type { Editor } from 'grapesjs';

/**
 * A single reusable overlay rectangle drawn *over* the canvas iframe (never
 * inside it) to highlight a component's element. Positions are computed from the
 * element's rect within the iframe plus the frame offset, scaled by the canvas
 * zoom.
 */
export class CanvasHighlight {
  private readonly editor: Editor;
  private el: HTMLElement | null = null;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  /** Show the overlay around `target` (a component's `view.el`). */
  show(target: HTMLElement | undefined | null): void {
    if (!target) {
      this.hide();
      return;
    }
    const rect = this.computeRect(target);
    if (!rect) {
      this.hide();
      return;
    }
    const el = this.ensure();
    el.style.top = `${rect.top}px`;
    el.style.left = `${rect.left}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
    el.style.display = '';
  }

  /** Hide the overlay. */
  hide(): void {
    if (this.el) this.el.style.display = 'none';
  }

  /** Remove the overlay element entirely. */
  destroy(): void {
    this.el?.remove();
    this.el = null;
  }

  private ensure(): HTMLElement {
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'gjs-dt gjs-dt-highlight';
      document.body.appendChild(this.el);
    }
    return this.el;
  }

  private computeRect(
    target: HTMLElement,
  ): { top: number; left: number; width: number; height: number } | null {
    try {
      const canvas = this.editor.Canvas;
      const frame = canvas.getFrameEl();
      if (!frame) return null;
      const zoom = (canvas.getZoom?.() ?? 100) / 100 || 1;
      const frameRect = frame.getBoundingClientRect();
      const r = target.getBoundingClientRect();
      return {
        top: frameRect.top + r.top * zoom,
        left: frameRect.left + r.left * zoom,
        width: r.width * zoom,
        height: r.height * zoom,
      };
    } catch {
      return null;
    }
  }
}
