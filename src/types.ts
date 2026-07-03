import type { Editor } from 'grapesjs';
import type { EditorBridge } from './core/EditorBridge';

/** Identifiers of the modules shipped with the plugin. */
export type ModuleId =
  | 'about'
  | 'component-inspector'
  | 'style-inspector'
  | 'event-logger'
  | 'repl'
  | 'storage-data'
  | 'managers-overview'
  | 'performance'
  | 'canvas-tools'
  | 'snapshots'
  | 'ai-assistant';

/** Docking side of the panel. */
export type PanelPosition = 'right' | 'left' | 'bottom';

/** Colour theme of the panel. `auto` follows `prefers-color-scheme`. */
export type PanelTheme = 'dark' | 'light' | 'auto';

/** Supported AI providers for the assistant module. */
export type AiProvider = 'claude' | 'openai' | 'gemini';

/** Configuration for the AI assistant module. */
export interface AiOptions {
  /** Which provider to use. Default: `'claude'`. */
  provider?: AiProvider;
  /** API key. Can also be entered in the panel (stored in localStorage). */
  apiKey?: string;
  /** Model id. Defaults per provider (Claude: `claude-opus-4-8`). */
  model?: string;
  /**
   * Optional custom endpoint. When set, the request is sent here instead of the
   * provider's default API. By default (`sendKeyToEndpoint: false`) it is a
   * **proxy**: no API key is sent from the browser — your proxy injects auth and
   * forwards to the provider (transparent pass-through, streaming supported).
   */
  endpoint?: string;
  /**
   * When `endpoint` is set, send the provider's normal auth (API key) **to** the
   * endpoint instead of treating it as a keyless proxy. Use this for
   * OpenAI-compatible base URLs (OpenRouter, Ollama, LM Studio, …) and
   * self-hosted gateways. Default: `false` (proxy mode).
   */
  sendKeyToEndpoint?: boolean;
  /** Stream the response token-by-token. Default: `true`. */
  stream?: boolean;
}

/** Options accepted by the plugin. All are optional; sensible defaults are applied. */
export interface DevtoolsOptions {
  /** Show the panel on start. Default: `false`. */
  enabled?: boolean;
  /** Toggle hotkey in GrapesJS keymap syntax. Default: `'ctrl+shift+d'`. */
  hotkey?: string;
  /** Docking side. Default: `'right'`. */
  position?: PanelPosition;
  /** Panel width in px for `position: 'right' | 'left'`. Default: `360`. */
  panelWidth?: number;
  /** Panel height in px for `position: 'bottom'`. Default: `280`. */
  panelHeight?: number;
  /** Which modules to enable. Default: all. */
  modules?: ModuleId[];
  /** Max number of retained event-log entries (ring buffer). Default: `500`. */
  eventLogLimit?: number;
  /** Colour theme. Default: `'dark'`. */
  theme?: PanelTheme;
  /** AI assistant configuration (provider/key/model). */
  ai?: AiOptions;
}

/** Fully-resolved options (no undefined fields). */
export type ResolvedOptions = Required<DevtoolsOptions>;

/**
 * A devtools module. Each tab in the panel is backed by one module.
 *
 * Lifecycle: `mount` is called once (lazily, on first tab open); `activate` /
 * `deactivate` fire on every tab switch; `destroy` fires when the panel is torn down.
 */
export interface DevtoolsModule {
  /** Stable id, used as the tab key. */
  readonly id: string;
  /** Human-readable tab title. */
  readonly title: string;
  /** Build the module UI into `el`. Called once, lazily. */
  mount(el: HTMLElement): void;
  /** Tab became visible. Start timers / RAF loops here. */
  activate?(): void;
  /** Tab hidden. Stop timers / RAF loops here. */
  deactivate?(): void;
  /** Panel destroyed. Release all resources. */
  destroy?(): void;
}

/** Context handed to every module constructor. */
export interface ModuleContext {
  editor: Editor;
  bridge: EditorBridge;
  options: ResolvedOptions;
  /** Look up another module instance by id (for cross-module APIs). */
  getModule(id: string): DevtoolsModule | undefined;
  /** Bring another module's tab to the front (mounting it if needed). */
  selectModule(id: string): void;
}

/** Factory signature for a module (so modules can be registered lazily). */
export type ModuleFactory = (ctx: ModuleContext) => DevtoolsModule;
