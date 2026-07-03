import type { Editor } from 'grapesjs';
import type {
  DevtoolsOptions,
  ResolvedOptions,
  ModuleId,
  ModuleFactory,
} from './types';
import { DevtoolsPanel } from './core/DevtoolsPanel';
import { AboutModule } from './modules/about/AboutModule';
import { ComponentInspectorModule } from './modules/component-inspector/ComponentInspectorModule';
import { StyleInspectorModule } from './modules/style-inspector/StyleInspectorModule';
import { EventLoggerModule } from './modules/event-logger/EventLoggerModule';
import { ReplModule } from './modules/repl/ReplModule';
import { StorageDataModule } from './modules/storage-data/StorageDataModule';
import { ManagersOverviewModule } from './modules/managers-overview/ManagersOverviewModule';
import { PerformanceModule } from './modules/performance/PerformanceModule';
import { CanvasToolsModule } from './modules/canvas-tools/CanvasToolsModule';
import { SnapshotsModule } from './modules/snapshots/SnapshotsModule';
import { AiAssistantModule } from './modules/ai-assistant/AiAssistantModule';
import './core/theme.css';

export type {
  DevtoolsOptions,
  DevtoolsModule,
  ModuleId,
  ModuleContext,
  PanelPosition,
  PanelTheme,
  AiProvider,
  AiOptions,
} from './types';

const ALL_MODULES: ModuleId[] = [
  'component-inspector',
  'style-inspector',
  'event-logger',
  'repl',
  'storage-data',
  'managers-overview',
  'performance',
  'canvas-tools',
  'snapshots',
  'ai-assistant',
  'about',
];

/** Factory table: maps a module id to its constructor. */
const FACTORIES: Record<ModuleId, ModuleFactory> = {
  about: (ctx) => new AboutModule(ctx),
  'component-inspector': (ctx) => new ComponentInspectorModule(ctx),
  'style-inspector': (ctx) => new StyleInspectorModule(ctx),
  'event-logger': (ctx) => new EventLoggerModule(ctx),
  repl: (ctx) => new ReplModule(ctx),
  'storage-data': (ctx) => new StorageDataModule(ctx),
  'managers-overview': (ctx) => new ManagersOverviewModule(ctx),
  performance: (ctx) => new PerformanceModule(ctx),
  'canvas-tools': (ctx) => new CanvasToolsModule(ctx),
  snapshots: (ctx) => new SnapshotsModule(ctx),
  'ai-assistant': (ctx) => new AiAssistantModule(ctx),
};

const DEFAULTS: ResolvedOptions = {
  enabled: false,
  hotkey: 'ctrl+shift+d',
  position: 'bottom',
  panelWidth: 360,
  panelHeight: 280,
  modules: ALL_MODULES,
  eventLogLimit: 500,
  theme: 'dark',
  ai: {},
};

const TOGGLE_CMD = 'devtools:toggle';

/**
 * Expand a hotkey so every `ctrl+…` combo also has a `⌘+…` twin — GrapesJS
 * keymaps accept a comma-separated list, so `Cmd+Shift+D` works on macOS too.
 * `withMacHotkey('ctrl+shift+d')` → `'ctrl+shift+d, ⌘+shift+d'`.
 */
function withMacHotkey(hotkey: string): string {
  const combos = hotkey
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const combo of combos) {
    out.push(combo);
    if (/(^|\+)ctrl(\+|$)/i.test(combo)) {
      out.push(combo.replace(/(^|\+)ctrl(\+|$)/i, (_m, a: string, b: string) => `${a}⌘${b}`));
    }
  }
  return [...new Set(out)].join(', ');
}

/**
 * GrapesJS plugin entry point.
 *
 * @example
 * ```ts
 * import grapesjs from 'grapesjs';
 * import devtools from 'grapesjs-devtools';
 *
 * grapesjs.init({
 *   container: '#gjs',
 *   plugins: [devtools],
 *   pluginsOpts: { 'grapesjs-devtools': { enabled: true, position: 'bottom' } },
 * });
 * ```
 */
export default function grapesjsDevtools(
  editor: Editor,
  opts: DevtoolsOptions = {},
): void {
  const options: ResolvedOptions = { ...DEFAULTS, ...opts };

  // Keep only known modules, preserving the canonical tab order.
  const enabled = ALL_MODULES.filter((m) => options.modules.includes(m));
  options.modules = enabled;

  const panel = new DevtoolsPanel(editor, options);
  for (const id of enabled) {
    panel.registerModule(id, FACTORIES[id]);
  }

  // Stateful toggle command: run -> show, stop -> hide.
  editor.Commands.add(TOGGLE_CMD, {
    run: () => {
      panel.show();
      return true;
    },
    stop: () => {
      panel.hide();
      return false;
    },
  });

  // Hotkey -> toggle. Bind a ⌘ variant alongside every ctrl combo so the
  // shortcut works on macOS (Cmd+Shift+D) as well as Windows/Linux.
  if (options.hotkey) {
    editor.Keymaps.add(TOGGLE_CMD, withMacHotkey(options.hotkey), () => {
      if (panel.isVisible) editor.stopCommand(TOGGLE_CMD);
      else editor.runCommand(TOGGLE_CMD);
    });
  }

  // Clean teardown with the editor.
  editor.on('destroy', () => panel.destroy());

  // Auto-open if requested (after load so managers are ready).
  if (options.enabled) {
    editor.onReady(() => editor.runCommand(TOGGLE_CMD));
  }
}
