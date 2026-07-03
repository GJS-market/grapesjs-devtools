import type { Editor } from 'grapesjs';

export interface OverlayBox {
  top: number;
  left: number;
  width: number;
  height: number;
  label?: string;
  /** Nesting depth, used to pick a border colour (cycled over 4 levels). */
  depth?: number;
}

/**
 * A single `position: fixed` layer drawn over (never inside) the canvas iframe.
 * Holds many boxes at once; positions are supplied by the module in viewport
 * coordinates. The layer itself is `pointer-events: none` so it never steals
 * clicks from the editor.
 */
export class CanvasOverlay {
  private readonly editor: Editor;
  private layer: HTMLElement | null = null;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  private ensure(): HTMLElement {
    if (!this.layer) {
      this.layer = document.createElement('div');
      this.layer.className = 'gjs-dt gjs-dt-overlay-layer';
      document.body.appendChild(this.layer);
    }
    return this.layer;
  }

  /** Convert an iframe element rect to viewport coords, accounting for zoom. */
  rectOf(el: HTMLElement): OverlayBox | null {
    try {
      const canvas = this.editor.Canvas;
      const frame = canvas.getFrameEl();
      if (!frame) return null;
      const zoom = (canvas.getZoom?.() ?? 100) / 100 || 1;
      const fr = frame.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return {
        top: fr.top + r.top * zoom,
        left: fr.left + r.left * zoom,
        width: r.width * zoom,
        height: r.height * zoom,
      };
    } catch {
      return null;
    }
  }

  /** Replace all boxes. */
  draw(boxes: OverlayBox[]): void {
    const layer = this.ensure();
    layer.textContent = '';
    for (const box of boxes) {
      const el = document.createElement('div');
      el.className = 'gjs-dt-ov-box';
      if (box.depth != null) el.dataset.depth = String(box.depth % 4);
      el.style.top = `${box.top}px`;
      el.style.left = `${box.left}px`;
      el.style.width = `${box.width}px`;
      el.style.height = `${box.height}px`;
      if (box.label) {
        const tag = document.createElement('span');
        tag.className = 'gjs-dt-ov-label';
        tag.textContent = box.label;
        el.appendChild(tag);
      }
      layer.appendChild(el);
    }
  }

  /** Draw a filled region (used for box-model padding/margin/content). */
  drawRegion(box: OverlayBox, cls: string, label?: string): void {
    const layer = this.ensure();
    const el = document.createElement('div');
    el.className = `gjs-dt-ov-region ${cls}`;
    el.style.top = `${box.top}px`;
    el.style.left = `${box.left}px`;
    el.style.width = `${box.width}px`;
    el.style.height = `${box.height}px`;
    if (label) {
      const tag = document.createElement('span');
      tag.className = 'gjs-dt-ov-label';
      tag.textContent = label;
      el.appendChild(tag);
    }
    layer.appendChild(el);
  }

  /** Remove everything but keep the layer element. */
  clear(): void {
    if (this.layer) this.layer.textContent = '';
  }

  /** Remove the layer entirely. */
  destroy(): void {
    this.layer?.remove();
    this.layer = null;
  }
}
