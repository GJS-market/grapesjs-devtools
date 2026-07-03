import type { Component } from 'grapesjs';
import type { DevtoolsModule, ModuleContext, AiProvider } from '../../types';
import { h, clear } from '../../utils/dom';
import {
  callProvider,
  PROVIDERS,
  type ProviderConfig,
  type ChatMessage,
} from './providers';
import { renderMarkdown } from './markdown';
import { ElementPicker, type PickedElement } from './ElementPicker';

const LS_KEY = 'gjs-devtools-ai';

/** Cap the chat history sent to the provider so long sessions stay bounded. */
const HISTORY_MAX = 24;

const SYSTEM_PROMPT = [
  'You are an expert assistant for GrapesJS, the open-source web builder framework.',
  'Answer developer questions as a practical FAQ entry: give a concrete, correct',
  'JavaScript example using the official GrapesJS API (editor.Panels, editor.Blocks',
  '/ BlockManager, editor.Commands, editor.DomComponents, editor.Styles,',
  'editor.Config, plugins, etc.), then a short explanation of how it works and why.',
  'When context about a selected component or a picked editor element is provided,',
  'tailor the answer to it (for example, how to add another button to that panel).',
  'Format answers in Markdown with fenced ```js code blocks. Be concise and practical.',
].join(' ');

const FAQ_SNIPPETS: string[] = [
  'How do I add a button to this panel?',
  'How do I register a custom block?',
  'How do I add a trait to the selected component?',
  'How do I run a command programmatically?',
  'How do I listen for component selection?',
  'How do I define a custom component type?',
];

/**
 * AI Assistant — ask questions about the editor and get GrapesJS code examples.
 *
 * Pick any part of the editor (a panel, a button, a manager) or select a canvas
 * component, then ask "how do I add another button here?" — the answer includes
 * example code and an explanation, FAQ-style. Backed by Claude, ChatGPT or Gemini.
 */
export class AiAssistantModule implements DevtoolsModule {
  readonly id = 'ai-assistant';
  readonly title = 'AI';

  private readonly ctx: ModuleContext;
  private readonly picker: ElementPicker;
  private readonly history: ChatMessage[] = [];
  private picked: PickedElement | null = null;
  private pending: AbortController | null = null;

  private outEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private contextEl!: HTMLElement;
  private sendBtn!: HTMLButtonElement;
  private settingsEl!: HTMLElement;

  constructor(ctx: ModuleContext) {
    this.ctx = ctx;
    this.picker = new ElementPicker();
  }

  mount(el: HTMLElement): void {
    const warn = h('div', {
      class: 'gjs-dt-repl-warn',
      text: '⚠ Sends your prompt and API key from the browser to the provider — development only.',
    });

    const toolbar = h(
      'div',
      { class: 'gjs-dt-toolbar' },
      h('button', {
        class: 'gjs-dt-btn',
        text: '🎯 Pick element',
        title: 'Click a part of the editor to ask about it',
        onclick: () => this.startPick(),
      }),
      h('button', {
        class: 'gjs-dt-btn',
        text: 'Use selection',
        title: 'Use the currently selected canvas component as context',
        onclick: () => {
          this.picked = null;
          this.renderContext();
        },
      }),
      h('button', {
        class: 'gjs-dt-btn',
        text: '⚙ Settings',
        onclick: () => this.toggleSettings(),
      }),
      h('button', {
        class: 'gjs-dt-btn',
        text: 'Clear',
        onclick: () => this.clearChat(),
      }),
    );

    this.settingsEl = h('div', {
      class: 'gjs-dt-ai-settings',
      style: 'display:none',
    });
    this.contextEl = h('div', { class: 'gjs-dt-ai-context' });

    const snips = h('div', { class: 'gjs-dt-repl-snips' });
    for (const q of FAQ_SNIPPETS) {
      snips.appendChild(
        h('button', {
          class: 'gjs-dt-btn gjs-dt-repl-snip',
          text: q,
          onclick: () => {
            this.inputEl.value = q;
            this.inputEl.focus();
          },
        }),
      );
    }

    this.outEl = h('div', { class: 'gjs-dt-ai-out' });
    this.inputEl = h('textarea', {
      class: 'gjs-dt-repl-input',
      placeholder: 'Ask about GrapesJS… (Enter to send, Shift+Enter for newline)',
      rows: 2,
    }) as HTMLTextAreaElement;
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send();
      } else if (e.key === 'Escape' && this.pending) {
        e.preventDefault();
        this.abort();
      }
    });
    this.sendBtn = h('button', {
      class: 'gjs-dt-btn',
      text: 'Send',
      onclick: () => (this.pending ? this.abort() : this.send()),
    }) as HTMLButtonElement;

    const inputRow = h(
      'div',
      { class: 'gjs-dt-ai-inputrow' },
      this.inputEl,
      this.sendBtn,
    );

    el.appendChild(
      h(
        'div',
        { class: 'gjs-dt-ai' },
        warn,
        toolbar,
        this.settingsEl,
        this.contextEl,
        snips,
        this.outEl,
        inputRow,
      ),
    );

    this.buildSettings();
    this.renderContext();

    // Keep the context chip fresh as the canvas selection changes.
    this.ctx.bridge.on('component:selected', () => this.renderContext());
    this.ctx.bridge.on('component:deselected', () => this.renderContext());
  }

  activate(): void {
    this.renderContext();
  }

  destroy(): void {
    this.abort();
    this.picker.destroy();
  }

  // ── Config ──────────────────────────────────────────────────────────────

  private loadConfig(): ProviderConfig {
    const opt = this.ctx.options.ai ?? {};
    let stored: Partial<ProviderConfig> = {};
    try {
      stored = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}');
    } catch {
      stored = {};
    }
    const provider = (stored.provider ?? opt.provider ?? 'claude') as AiProvider;
    const apiKey = stored.apiKey ?? opt.apiKey ?? '';
    const model = stored.model ?? opt.model ?? PROVIDERS[provider].defaultModel;
    const endpoint = stored.endpoint ?? opt.endpoint ?? '';
    const sendKeyToEndpoint =
      stored.sendKeyToEndpoint ?? opt.sendKeyToEndpoint ?? false;
    const stream = stored.stream ?? opt.stream ?? true;
    return { provider, apiKey, model, endpoint, sendKeyToEndpoint, stream };
  }

  private saveConfig(cfg: ProviderConfig): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(cfg));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }

  private buildSettings(): void {
    const cfg = this.loadConfig();
    clear(this.settingsEl);

    const providerSel = h('select', { class: 'gjs-dt-input' }) as HTMLSelectElement;
    for (const key of Object.keys(PROVIDERS) as AiProvider[]) {
      const opt = h('option', {
        value: key,
        text: PROVIDERS[key].label,
      }) as HTMLOptionElement;
      if (key === cfg.provider) opt.selected = true;
      providerSel.appendChild(opt);
    }

    const keyInput = h('input', {
      class: 'gjs-dt-input',
      type: 'password',
      value: cfg.apiKey,
      placeholder: 'API key (stored locally in this browser)',
      style: 'flex:1 1 auto',
    }) as HTMLInputElement;

    const modelInput = h('input', {
      class: 'gjs-dt-input',
      value: cfg.model,
      placeholder: 'model',
      style: 'flex:1 1 auto',
    }) as HTMLInputElement;

    const endpointInput = h('input', {
      class: 'gjs-dt-input',
      value: cfg.endpoint ?? '',
      placeholder: 'https://your-proxy-or-base-url.example/…  (optional)',
      style: 'flex:1 1 auto',
    }) as HTMLInputElement;

    const sendKeyToggle = h('input', { type: 'checkbox' }) as HTMLInputElement;
    sendKeyToggle.checked = cfg.sendKeyToEndpoint === true;

    const streamToggle = h('input', { type: 'checkbox' }) as HTMLInputElement;
    streamToggle.checked = cfg.stream !== false;

    const persist = () => {
      this.saveConfig({
        provider: providerSel.value as AiProvider,
        apiKey: keyInput.value,
        model: modelInput.value.trim(),
        endpoint: endpointInput.value.trim(),
        sendKeyToEndpoint: sendKeyToggle.checked,
        stream: streamToggle.checked,
      });
    };
    providerSel.addEventListener('change', () => {
      // Switching provider resets the model to that provider's default.
      modelInput.value = PROVIDERS[providerSel.value as AiProvider].defaultModel;
      keyInput.placeholder = `API key (${PROVIDERS[providerSel.value as AiProvider].keyHint})`;
      persist();
    });
    keyInput.addEventListener('change', persist);
    modelInput.addEventListener('change', persist);
    endpointInput.addEventListener('change', persist);
    sendKeyToggle.addEventListener('change', persist);
    streamToggle.addEventListener('change', persist);

    this.settingsEl.appendChild(
      h(
        'div',
        { class: 'gjs-dt-section' },
        h('h4', { text: 'Provider' }),
        h('div', { class: 'gjs-dt-toolbar' }, providerSel),
        h('h4', { text: 'API key' }),
        h('div', { class: 'gjs-dt-toolbar' }, keyInput),
        h('h4', { text: 'Model' }),
        h('div', { class: 'gjs-dt-toolbar' }, modelInput),
        h('h4', { text: 'Custom endpoint (optional)' }),
        h('div', { class: 'gjs-dt-toolbar' }, endpointInput),
        h(
          'div',
          { class: 'gjs-dt-toolbar' },
          h('label', {}, sendKeyToggle, ' Endpoint is a provider (send API key)'),
        ),
        h(
          'div',
          { class: 'gjs-dt-toolbar' },
          h('label', {}, streamToggle, ' Stream responses'),
        ),
        h('div', {
          class: 'gjs-dt-muted',
          text: 'Keys are stored only in this browser. Leave the box off to treat the endpoint as a keyless proxy (key stays server-side). Turn it on for OpenAI-compatible base URLs (OpenRouter, Ollama, LM Studio) — the API key is sent to the endpoint.',
        }),
      ),
    );
  }

  private toggleSettings(): void {
    const showing = this.settingsEl.style.display !== 'none';
    this.settingsEl.style.display = showing ? 'none' : '';
    if (!showing) this.buildSettings();
  }

  // ── Context ─────────────────────────────────────────────────────────────

  private async startPick(): Promise<void> {
    const picked = await this.picker.pick();
    if (picked) {
      this.picked = picked;
      this.renderContext();
    }
  }

  private renderContext(): void {
    clear(this.contextEl);
    const chips: HTMLElement[] = [];
    const sel = this.ctx.editor.getSelected() as Component | undefined;
    if (sel) {
      const type =
        (sel.get('type') as string) || (sel.get('tagName') as string) || 'component';
      chips.push(h('span', { class: 'gjs-dt-badge', text: `selection: ${type}` }));
    }
    if (this.picked) {
      chips.push(
        h('span', {
          class: 'gjs-dt-badge',
          text: `picked: <${this.picked.tag}>`,
          title: this.picked.area,
        }),
      );
      chips.push(
        h('button', {
          class: 'gjs-dt-btn gjs-dt-ai-clearctx',
          text: '✕',
          title: 'Clear picked element',
          onclick: () => {
            this.picked = null;
            this.renderContext();
          },
        }),
      );
    }
    if (!chips.length) {
      this.contextEl.appendChild(
        h('span', {
          class: 'gjs-dt-muted',
          text: 'No context — pick an element or select a component to ground the answer.',
        }),
      );
      return;
    }
    this.contextEl.appendChild(h('span', { class: 'gjs-dt-muted', text: 'Context: ' }));
    for (const c of chips) this.contextEl.appendChild(c);
  }

  private buildContextText(): string {
    const parts: string[] = [];
    const sel = this.ctx.editor.getSelected() as Component | undefined;
    if (sel) {
      const type =
        (sel.get('type') as string) || (sel.get('tagName') as string) || 'component';
      const classes = sel.getClasses?.() ?? [];
      parts.push(
        `Selected canvas component: type="${type}"` +
          (classes.length ? `, classes=[${classes.join(', ')}]` : '') +
          (sel.getId?.() ? `, id="${sel.getId()}"` : '') +
          '.',
      );
    }
    if (this.picked) {
      const p = this.picked;
      parts.push(
        `The user pointed at a part of the GrapesJS EDITOR UI: ${p.area}. ` +
          `Element: <${p.tag}${p.id ? ` id="${p.id}"` : ''}` +
          `${p.classes.length ? ` class="${p.classes.join(' ')}"` : ''}>. ` +
          `HTML: ${p.html}`,
      );
    }
    return parts.length ? `Context:\n${parts.join('\n')}\n\n` : '';
  }

  // ── Chat ────────────────────────────────────────────────────────────────

  private async send(): Promise<void> {
    const question = this.inputEl.value.trim();
    if (!question || this.pending) return;
    const cfg = this.loadConfig();
    if (!cfg.apiKey && !cfg.endpoint) {
      this.appendError(
        'No API key set — open ⚙ Settings (or set a proxy endpoint).',
      );
      this.toggleSettings();
      return;
    }

    const content = this.buildContextText() + question;
    this.history.push({ role: 'user', content });
    this.trimHistory();
    this.appendBubble('user', question);
    this.inputEl.value = '';

    const bubble = this.appendAssistant();
    this.setPending(true);
    const controller = new AbortController();
    this.pending = controller;

    let acc = '';
    const streaming = cfg.stream !== false;
    try {
      const answer = await callProvider(cfg, SYSTEM_PROMPT, this.history, {
        signal: controller.signal,
        onToken: streaming
          ? (delta) => {
              acc += delta;
              bubble.setRaw(acc);
              this.scroll();
            }
          : undefined,
      });
      bubble.finalize(answer || acc);
      this.history.push({ role: 'assistant', content: answer || acc });
    } catch (err) {
      // Keep any streamed partial as the assistant turn; otherwise drop the bubble.
      if (acc.trim()) {
        bubble.finalize(acc);
        this.history.push({ role: 'assistant', content: acc });
      } else {
        bubble.remove();
        this.history.pop();
      }
      if ((err as Error).name === 'AbortError') this.appendError('Cancelled.');
      else this.appendError((err as Error).message);
    } finally {
      this.trimHistory();
      this.setPending(false);
      this.pending = null;
      this.scroll();
    }
  }

  /** Keep only the most recent turns so token usage stays bounded. */
  private trimHistory(): void {
    if (this.history.length > HISTORY_MAX) {
      this.history.splice(0, this.history.length - HISTORY_MAX);
    }
  }

  private abort(): void {
    this.pending?.abort();
  }

  private setPending(pending: boolean): void {
    this.sendBtn.textContent = pending ? 'Stop' : 'Send';
    this.sendBtn.classList.toggle('is-active', pending);
  }

  private appendBubble(role: 'user' | 'assistant', text: string): void {
    const bubble = h('div', { class: `gjs-dt-ai-msg gjs-dt-ai-${role}` });
    if (role === 'user') {
      bubble.appendChild(h('div', { class: 'gjs-dt-ai-txt', text }));
    } else {
      bubble.appendChild(renderMarkdown(text));
    }
    this.outEl.appendChild(bubble);
    this.scroll();
  }

  /**
   * Append an assistant bubble that can show streaming raw text and later be
   * finalized into rendered Markdown.
   */
  private appendAssistant(): {
    setRaw: (text: string) => void;
    finalize: (markdown: string) => void;
    remove: () => void;
  } {
    const bubble = h('div', {
      class: 'gjs-dt-ai-msg gjs-dt-ai-assistant gjs-dt-ai-pending',
    });
    const raw = h('div', {
      class: 'gjs-dt-ai-txt gjs-dt-mono',
      text: '…thinking',
    });
    bubble.appendChild(raw);
    this.outEl.appendChild(bubble);
    this.scroll();
    return {
      setRaw: (text) => {
        raw.textContent = text;
      },
      finalize: (markdown) => {
        bubble.classList.remove('gjs-dt-ai-pending');
        clear(bubble);
        bubble.appendChild(renderMarkdown(markdown));
      },
      remove: () => bubble.remove(),
    };
  }

  private appendError(msg: string): void {
    this.outEl.appendChild(
      h('div', { class: 'gjs-dt-ai-msg gjs-dt-repl-err', text: msg }),
    );
    this.scroll();
  }

  private clearChat(): void {
    this.history.length = 0;
    clear(this.outEl);
  }

  private scroll(): void {
    this.outEl.scrollTop = this.outEl.scrollHeight;
  }
}
