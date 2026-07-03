import type { Editor } from 'grapesjs';

type Handler = (...args: any[]) => void;

interface Subscription {
  event: string;
  cb: Handler;
}

/**
 * Safe, leak-proof wrapper around the editor's event bus.
 *
 * Every module subscribes **only** through a bridge. The bridge records each
 * subscription, so {@link EditorBridge.disposeAll} can remove all of them when
 * the panel closes — guaranteeing `editor._events` returns to its baseline
 * (a Definition-of-Done requirement).
 */
export class EditorBridge {
  private readonly editor: Editor;
  private subs: Subscription[] = [];
  private disposed = false;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  /** Subscribe to an editor event. Use `'all'` for the firehose. */
  on(event: string, cb: Handler): this {
    if (this.disposed) return this;
    this.editor.on(event, cb);
    this.subs.push({ event, cb });
    return this;
  }

  /** Subscribe once; auto-removed from tracking after it fires. */
  once(event: string, cb: Handler): this {
    if (this.disposed) return this;
    const wrapped: Handler = (...args: any[]) => {
      this.off(event, wrapped);
      cb(...args);
    };
    return this.on(event, wrapped);
  }

  /** Remove a specific subscription previously added via this bridge. */
  off(event: string, cb: Handler): this {
    this.editor.off(event, cb);
    this.subs = this.subs.filter((s) => !(s.event === event && s.cb === cb));
    return this;
  }

  /** Number of live subscriptions held by this bridge (for diagnostics/tests). */
  get size(): number {
    return this.subs.length;
  }

  /** Direct (untracked) access to the editor, for read-only calls. */
  get instance(): Editor {
    return this.editor;
  }

  /** Remove every subscription this bridge added. Idempotent. */
  disposeAll(): void {
    for (const { event, cb } of this.subs) {
      try {
        this.editor.off(event, cb);
      } catch {
        /* editor may already be destroyed */
      }
    }
    this.subs = [];
    this.disposed = true;
  }
}
