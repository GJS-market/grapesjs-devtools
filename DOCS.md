# grapesjs-devtools — Documentation

> Developer panel inside the GrapesJS editor — like the browser DevTools, but for
> the editor's internal state.
>
> Built by **[gjs.market](https://gjs.market)** for the whole GrapesJS community. ♥
> Need custom GrapesJS work? → **[gjs.market/services](https://gjs.market/services)**

---

## Table of contents

- [Install](#install)
- [Quick start](#quick-start)
- [Toggling the panel](#toggling-the-panel)
- [Options](#options)
- [The panel](#the-panel) — docking, resize, theme, help link
- [Modules](#modules)
  - [Components](#components) · [Styles](#styles) · [Events](#events) ·
    [Console](#console) · [Storage](#storage) · [Managers](#managers) ·
    [Perf](#perf) · [Canvas](#canvas) · [Snapshots](#snapshots) ·
    [AI](#ai) · [About](#about)
- [AI assistant setup](#ai-assistant-setup) — providers, proxy, OpenAI-compatible, streaming
- [Writing a custom module](#writing-a-custom-module)
- [Development](#development)
- [Support & services](#support--services)

---

## Install

```bash
npm install grapesjs-devtools
```

`grapesjs` is a **peer dependency** — compatible with GrapesJS `>= 0.21.0`. The plugin ships as ESM + UMD
with TypeScript types and has **zero runtime dependencies** (vanilla DOM UI).

## Quick start

```ts
import grapesjs from 'grapesjs';
import 'grapesjs/dist/css/grapes.min.css';
import devtools from 'grapesjs-devtools';
import 'grapesjs-devtools/dist/style.css';

const editor = grapesjs.init({
  container: '#gjs',
  plugins: [devtools],
  pluginsOpts: {
    'grapesjs-devtools': { enabled: true, position: 'bottom', theme: 'dark' },
  },
});
```

Or configure inline (handy when you need option types):

```ts
grapesjs.init({
  container: '#gjs',
  plugins: [(editor) => devtools(editor, { enabled: true, theme: 'auto' })],
});
```

### Without a bundler (UMD)

```html
<link rel="stylesheet" href="https://unpkg.com/grapesjs/dist/css/grapes.min.css" />
<link rel="stylesheet" href="grapesjs-devtools/dist/grapesjs-devtools.css" />
<script src="https://unpkg.com/grapesjs"></script>
<script src="grapesjs-devtools/dist/grapesjs-devtools.umd.cjs"></script>
<script>
  const editor = grapesjs.init({
    container: '#gjs',
    plugins: [(ed) => grapesjsDevtools(ed, { enabled: true })],
  });
</script>
```

## Toggling the panel

- **Hotkey:** `Ctrl+Shift+D` — or `⌘+Shift+D` on macOS (configurable via
  `hotkey`; every `ctrl+…` combo is auto-bound to `⌘+…` too).
- **Command:** the plugin registers a stateful `devtools:toggle` command.

```ts
editor.runCommand('devtools:toggle');   // open
editor.stopCommand('devtools:toggle');  // close
```

## Options

Pass under `pluginsOpts['grapesjs-devtools']` or as the second argument to the
plugin function.

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `false` | Open the panel on start. |
| `hotkey` | `string` | `'ctrl+shift+d'` | GrapesJS keymap syntax. |
| `position` | `'right' \| 'left' \| 'bottom'` | `'bottom'` | Docking side. Also switchable live from the header, and persisted. |
| `panelWidth` | `number` | `360` | Width in px (`position: 'right' \| 'left'`). |
| `panelHeight` | `number` | `280` | Height in px (`position: 'bottom'`). |
| `modules` | `ModuleId[]` | all | Which modules (tabs) to enable. |
| `eventLogLimit` | `number` | `500` | Event-log ring-buffer size. |
| `theme` | `'dark' \| 'light' \| 'auto'` | `'dark'` | `auto` follows `prefers-color-scheme`. |
| `ai` | `AiOptions` | `{}` | AI assistant config — see [AI assistant setup](#ai-assistant-setup). |

**`ModuleId`** = `'component-inspector' | 'style-inspector' | 'event-logger' |
'repl' | 'storage-data' | 'managers-overview' | 'performance' | 'canvas-tools' |
'snapshots' | 'ai-assistant' | 'about'`.

Enable a subset:

```ts
devtools(editor, { modules: ['component-inspector', 'event-logger', 'repl', 'about'] });
```

## The panel

- **Docking** — dock **left / right / bottom**, switchable live with the
  `⇤ ⇩ ⇥` buttons in the header. The choice is persisted in `localStorage`.
- **Resize** — drag the inner edge; size is persisted per dock side.
- **Theme** — dark (default), light, or `auto`. All colours come from CSS
  variables (`--gjs-dt-*`), so both themes are first-class.
- **Help** — the `?` in the header opens
  [gjs.market/services](https://gjs.market/services).
- **Non-intrusive** — the panel is a `position: fixed` overlay; it never writes
  into the canvas iframe (the one exception is Canvas Tools' explicit
  pointer-events toggle).
- **Lazy & leak-free** — each module mounts on first open; every editor
  subscription goes through an internal `EditorBridge` that is disposed on
  teardown, so `editor`'s event bus returns to its baseline when the panel is
  destroyed.

## Modules

### Components
Live component tree from `editor.getWrapper()`. Two-way selection with the
canvas (click a node ↔ select in canvas), inline editing of **attributes** and
**traits**, **breadcrumbs**, hover-highlight over the canvas, and **Copy JSON**.
The tree renders children lazily, so 1000+ component projects stay responsive.

### Styles
CSS rules applying to the selected component, in cascade order, with
**overridden properties struck through** (like browser DevTools) and **inline
editing** of values. An **All rules** mode searches every project rule by
selector or property, and **Scan dead rules** flags selectors that match no
element in the canvas.

> Matching uses `element.matches(selector)` against the element's *current* DOM
> state: state rules (`:hover`, …) are matched on their base selector,
> pseudo-elements/non-rendered states are listed but flagged, and non-active
> `@media` rules are shown with their label but not evaluated.

### Events
The editor's whole event firehose via a **single** `editor.on('all', …)`
listener. A **virtualized** list (thousands of events/min), group + text
**filters**, **Pause/Clear**, a **Stats** view (per-event counts, >50/s flagged
as spam), and click-to-expand payloads (Backbone models are safely serialized to
`{__model, cid, attrs}`).

### Console
A REPL with `editor` and `$0` (the selected component) in scope. History (↑/↓,
saved to `sessionStorage`), `editor.` autocomplete, quick snippet buttons, and
Promise-aware results rendered through the JSON viewer.

> Executes arbitrary JS in the page context — development only.

### Storage
Sub-tabs: **Project Data** (JSON tree), **Diff** (structural diff between two
snapshots, by JSON path), **Export/Import** (`getProjectData` /
`loadProjectData`), **HTML** / **CSS** (syntax-highlighted, copyable), and a
**Storage Log** of `storage:*` events.

### Managers
Accordion over **Blocks, Traits, Selectors, Devices** and configured
**Plugins**. Click a device to switch it; click a selector to filter it in the
Styles tab.

### Perf
Live metrics (components, CSS rules, selectors, editor listeners, undo-stack
size), **UndoManager** controls, a **canvas re-render timer** (min/avg/max), and
a **baseline → compare** leak detector. Private-API reads degrade to `n/a`
instead of throwing.

### Canvas
Overlay tools drawn above the canvas: **highlight every component** (coloured by
nesting depth) with the selection's **box model**, a **pointer-events killer**
for the canvas body, and **scroll-to-selected**. Accounts for canvas zoom.

### Snapshots
Capture/restore full project state (project data + selection + device) with
**export**, drag-and-drop **import**, and optional **localStorage persistence**
(handles `QuotaExceededError`). Emits `devtools:snapshot:restored` on restore.

### AI
Ask GrapesJS questions and get code examples — see
[AI assistant setup](#ai-assistant-setup).

### About
Versions, enabled modules, links, attribution, and the **development services**
link.

---

## AI assistant setup

The **AI** tab answers GrapesJS questions with example code, FAQ-style. Use
**🎯 Pick element** to click any part of the editor (a panel, a button, a
manager) or select a component on the canvas — that becomes context — then ask
(e.g. *"how do I add another button to this panel?"*). Responses **stream** in
and render as Markdown with copyable code. **Esc** cancels an in-progress
request.

Set the provider, key and model in the tab's **⚙ Settings** (stored only in your
browser's `localStorage`) or via the `ai` option:

```ts
interface AiOptions {
  provider?: 'claude' | 'openai' | 'gemini';   // default 'claude'
  apiKey?: string;
  model?: string;                              // provider default otherwise
  stream?: boolean;                            // default true
  endpoint?: string;                           // custom proxy / base URL
  sendKeyToEndpoint?: boolean;                 // default false
}
```

Defaults: Claude → `claude-opus-4-8`, OpenAI → `gpt-4o`, Gemini →
`gemini-2.0-flash`.

### Direct (default)

The request is sent from the browser straight to the provider. Anthropic calls
add the `anthropic-dangerous-direct-browser-access` header. Convenient for local
dev; a warning is shown in the UI because the key is exposed to the page.

### Proxy mode — keep your key server-side

Set `endpoint` (leave `sendKeyToEndpoint` **off**). The provider-native body
(including `stream`) is POSTed to your endpoint with a `x-devtools-provider`
header and **no key**; your proxy injects auth and streams the response back.

```js
// POST /api → Anthropic, injecting the key
app.post('/api', async (req, res) => {
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(req.body),
  });
  res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
  upstream.body.pipe(res); // stream SSE straight through
});
```

### OpenAI-compatible / self-hosted (OpenRouter, Ollama, LM Studio, …)

Set `provider: 'openai'`, put the base URL in `endpoint`, and turn
`sendKeyToEndpoint` **on** (the "Endpoint is a provider (send API key)"
checkbox). The key is then sent to that endpoint.

```ts
// OpenRouter
ai: { provider: 'openai', endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      apiKey: 'sk-or-…', model: 'meta-llama/llama-3.1-8b-instruct', sendKeyToEndpoint: true }

// Ollama (local)
ai: { provider: 'openai', endpoint: 'http://localhost:11434/v1/chat/completions',
      apiKey: 'ollama', model: 'llama3.1', sendKeyToEndpoint: true }
```

Only the most recent turns are kept in the conversation sent to the provider, so
long chats don't grow token usage without bound.

---

## Writing a custom module

A module is a small class. It receives a `ModuleContext`
(`{ editor, bridge, options, getModule, selectModule }`) and must subscribe to
editor events **only** through `ctx.bridge` so it's leak-free.

```ts
import type { DevtoolsModule, ModuleContext } from 'grapesjs-devtools';

class HelloModule implements DevtoolsModule {
  id = 'hello';
  title = 'Hello';
  constructor(private ctx: ModuleContext) {}

  mount(el: HTMLElement) {
    el.textContent = `Components: ${this.ctx.editor.getWrapper()?.components().length ?? 0}`;
    this.ctx.bridge.on('component:add', () => { /* … */ });
  }
  activate() { /* tab shown — start timers/RAF */ }
  deactivate() { /* tab hidden — stop them */ }
  destroy() { /* release resources */ }
}
```

Lifecycle: `mount` runs once (lazily, on first open); `activate`/`deactivate`
fire on every tab switch; `destroy` on panel teardown. Style with the theme CSS
variables (`--gjs-dt-*`) so your module works in dark and light.

> The built-in registry isn't a public registration API yet — custom modules are
> a fork/PR extension point today. Want first-class custom modules or a bespoke
> tab? [gjs.market/services](https://gjs.market/services).

---

## Development

```bash
npm install
npm run dev        # Vite dev server + demo at http://localhost:5173
npm run typecheck  # tsc --strict
npm test           # vitest (pure-util unit tests)
npm run build      # ESM + UMD + d.ts into dist/ (the published package)
npm run build:site # demo site into dist-site/ (what Netlify publishes)
```

`npm run dev` serves the `demo/` site — a full GrapesJS editor with the plugin
loaded from source (GrapesJS from `node_modules`, no CDN) and a top switcher
between the **Webpage preset** and **GrapesJS Studio**. Press `Ctrl+Shift+D`
(`⌘+Shift+D` on macOS).

The switcher is demo-only: `demo/` is excluded from the published npm package, so
installing the plugin gives you just the devtools panel.

---

## Support & services

This plugin is free and open source, built by **[gjs.market](https://gjs.market)**
for the GrapesJS community.

Need custom GrapesJS development — plugins, integrations, a tailored editor, or
help wiring this into your product? → **[gjs.market/services](https://gjs.market/services)**

- Issues / contributions: [GitHub](https://github.com/GJS-market/grapesjs-devtools)
- More GrapesJS plugins & tools: [gjs.market](https://gjs.market)
