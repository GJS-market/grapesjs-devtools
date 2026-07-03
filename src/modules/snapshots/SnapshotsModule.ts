import type { Component } from 'grapesjs';
import type { DevtoolsModule, ModuleContext } from '../../types';
import { h, clear, downloadFile } from '../../utils/dom';
import { formatTime, formatBytes, byteLength, fileTimestamp } from '../../utils/format';

interface Snapshot {
  name: string;
  ts: number;
  projectData: unknown;
  selectedCid: string | null;
  device: string;
}

const LS_KEY = 'gjs-devtools-snapshots';
const LIMIT = 10;

/**
 * Snapshots — capture the full project state (project data + selection + device)
 * and restore it later. Snapshots live in memory (capped at 10) and can be
 * optionally persisted to localStorage, exported and imported.
 *
 * After a restore the module emits `devtools:snapshot:restored` so other modules
 * (inspector, logger, …) can refresh.
 */
export class SnapshotsModule implements DevtoolsModule {
  readonly id = 'snapshots';
  readonly title = 'Snapshots';

  private readonly ctx: ModuleContext;
  private snapshots: Snapshot[] = [];
  private persist = false;

  private nameInput!: HTMLInputElement;
  private listEl!: HTMLElement;
  private persistToggle!: HTMLInputElement;
  private statusEl!: HTMLElement;

  constructor(ctx: ModuleContext) {
    this.ctx = ctx;
    this.loadPersisted();
  }

  mount(el: HTMLElement): void {
    this.nameInput = h('input', {
      class: 'gjs-dt-input',
      placeholder: 'snapshot name…',
      style: 'flex:1 1 auto',
    }) as HTMLInputElement;

    const takeBtn = h('button', {
      class: 'gjs-dt-btn',
      text: 'Take snapshot',
      onclick: () => this.take(),
    });

    this.persistToggle = h('input', { type: 'checkbox' }) as HTMLInputElement;
    this.persistToggle.checked = this.persist;
    this.persistToggle.addEventListener('change', () => {
      this.persist = this.persistToggle.checked;
      if (this.persist) this.savePersisted();
      else this.clearPersisted();
    });

    const fileInput = h('input', {
      type: 'file',
      attrs: { accept: 'application/json,.json' },
      style: 'display:none',
    }) as HTMLInputElement;
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) this.importFile(file);
      fileInput.value = '';
    });
    const importBtn = h('button', {
      class: 'gjs-dt-btn',
      text: 'Import…',
      onclick: () => fileInput.click(),
    });

    this.statusEl = h('div', { class: 'gjs-dt-muted', style: 'margin:4px 8px' });
    this.listEl = h('div', { class: 'gjs-dt-scroll gjs-dt-snap-list' });

    // Drag & drop import onto the list area.
    this.listEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.listEl.classList.add('gjs-dt-snap-drop');
    });
    this.listEl.addEventListener('dragleave', () =>
      this.listEl.classList.remove('gjs-dt-snap-drop'),
    );
    this.listEl.addEventListener('drop', (e) => {
      e.preventDefault();
      this.listEl.classList.remove('gjs-dt-snap-drop');
      const file = e.dataTransfer?.files?.[0];
      if (file) this.importFile(file);
    });

    el.appendChild(
      h(
        'div',
        { class: 'gjs-dt-snap' },
        h('div', { class: 'gjs-dt-toolbar' }, this.nameInput, takeBtn, importBtn, fileInput),
        h(
          'div',
          { class: 'gjs-dt-toolbar' },
          h('label', {}, this.persistToggle, ' Persist to localStorage'),
        ),
        this.statusEl,
        this.listEl,
      ),
    );
    this.renderList();
  }

  destroy(): void {
    this.snapshots = [];
  }

  // ── Capture ──────────────────────────────────────────────────────────

  private take(): void {
    const sel = this.ctx.editor.getSelected() as Component | undefined;
    const snap: Snapshot = {
      name: this.nameInput.value.trim() || `snapshot ${this.snapshots.length + 1}`,
      ts: Date.now(),
      projectData: this.ctx.editor.getProjectData(),
      selectedCid: sel ? (sel as unknown as { cid: string }).cid : null,
      device: String(this.ctx.editor.getDevice() ?? ''),
    };
    this.snapshots.push(snap);
    if (this.snapshots.length > LIMIT) this.snapshots.shift();
    this.nameInput.value = '';
    if (this.persist) this.savePersisted();
    this.renderList();
  }

  // ── Restore ──────────────────────────────────────────────────────────

  private restore(snap: Snapshot): void {
    if (!window.confirm(`Restore "${snap.name}"? This overwrites the current project.`)) {
      return;
    }
    try {
      this.ctx.editor.loadProjectData(snap.projectData as never);
      if (snap.device) {
        try {
          this.ctx.editor.setDevice(snap.device);
        } catch {
          /* device may not exist anymore */
        }
      }
      if (snap.selectedCid) {
        const comp = this.findByCid(
          this.ctx.editor.getWrapper() as Component,
          snap.selectedCid,
        );
        if (comp) this.ctx.editor.select(comp);
      }
      // Notify other modules.
      this.ctx.editor.trigger('devtools:snapshot:restored', snap);
      this.setStatus(`Restored "${snap.name}"`, false);
    } catch (err) {
      this.setStatus(`Restore failed: ${(err as Error).message}`, true);
    }
  }

  private findByCid(root: Component, cid: string): Component | undefined {
    if ((root as unknown as { cid: string }).cid === cid) return root;
    const kids = root.components();
    for (let i = 0; i < kids.length; i++) {
      const found = this.findByCid(kids.at(i) as Component, cid);
      if (found) return found;
    }
    return undefined;
  }

  // ── List rendering ───────────────────────────────────────────────────

  private renderList(): void {
    clear(this.listEl);
    if (!this.snapshots.length) {
      this.listEl.appendChild(h('div', { class: 'gjs-dt-empty', text: 'No snapshots yet' }));
      return;
    }
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      const snap = this.snapshots[i];
      const json = JSON.stringify(snap.projectData);
      const row = h(
        'div',
        { class: 'gjs-dt-snap-row' },
        h(
          'div',
          { class: 'gjs-dt-snap-meta' },
          h('span', { class: 'gjs-dt-snap-name', text: snap.name }),
          h('span', {
            class: 'gjs-dt-muted',
            text: `${formatTime(snap.ts)} · ${formatBytes(byteLength(json))}${snap.device ? ' · ' + snap.device : ''}`,
          }),
        ),
        h(
          'div',
          { class: 'gjs-dt-snap-actions' },
          h('button', { class: 'gjs-dt-btn', text: 'Restore', onclick: () => this.restore(snap) }),
          h('button', { class: 'gjs-dt-btn', text: 'Export', onclick: () => this.export(snap) }),
          h('button', { class: 'gjs-dt-btn', text: 'Delete', onclick: () => this.remove(i) }),
        ),
      );
      this.listEl.appendChild(row);
    }
  }

  private remove(index: number): void {
    this.snapshots.splice(index, 1);
    if (this.persist) this.savePersisted();
    this.renderList();
  }

  private export(snap: Snapshot): void {
    const safe = snap.name.replace(/[^a-z0-9-_]+/gi, '-');
    downloadFile(
      `snapshot-${safe}-${fileTimestamp(snap.ts)}.json`,
      JSON.stringify(snap, null, 2),
    );
  }

  // ── Import ───────────────────────────────────────────────────────────

  private importFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!this.isSnapshot(data)) {
          this.setStatus('Invalid snapshot file (missing name/ts/projectData)', true);
          return;
        }
        this.snapshots.push(data);
        if (this.snapshots.length > LIMIT) this.snapshots.shift();
        if (this.persist) this.savePersisted();
        this.renderList();
        this.setStatus(`Imported "${data.name}"`, false);
      } catch (err) {
        this.setStatus(`Import failed: ${(err as Error).message}`, true);
      }
    };
    reader.readAsText(file);
  }

  private isSnapshot(v: unknown): v is Snapshot {
    return (
      typeof v === 'object' &&
      v !== null &&
      typeof (v as Snapshot).name === 'string' &&
      typeof (v as Snapshot).ts === 'number' &&
      'projectData' in (v as object)
    );
  }

  // ── Persistence ──────────────────────────────────────────────────────

  private loadPersisted(): void {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.snapshots = parsed.filter((s) => this.isSnapshot(s)).slice(-LIMIT);
        this.persist = true;
      }
    } catch {
      /* ignore corrupt storage */
    }
  }

  private savePersisted(): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.snapshots));
    } catch (err) {
      const quota =
        err instanceof DOMException &&
        (err.name === 'QuotaExceededError' || err.code === 22);
      this.persist = false;
      if (this.persistToggle) this.persistToggle.checked = false;
      this.setStatus(
        quota
          ? 'localStorage quota exceeded — persist disabled'
          : `Persist failed: ${(err as Error).message}`,
        true,
      );
    }
  }

  private clearPersisted(): void {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
  }

  private setStatus(text: string, isError: boolean): void {
    this.statusEl.textContent = text;
    this.statusEl.className = isError ? 'gjs-dt-sd-err' : 'gjs-dt-sd-ok';
    this.statusEl.style.margin = '4px 8px';
  }
}
