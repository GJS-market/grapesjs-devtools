import grapesjs from 'grapesjs';
import type { DevtoolsModule, ModuleContext } from '../../types';
import { h } from '../../utils/dom';
import { PLUGIN_VERSION } from '../../version';

const GJS_MARKET = 'https://gjs.market';
const GJS_SERVICES = 'https://gjs.market/services';
const GJS_PRODUCT =
  'https://gjs.market/products/grapesjs-devtools-debugging-developer-toolkit';
const REPO = 'https://github.com/GJS-market/grapesjs-devtools';

/**
 * "About" module — the plugin's info & help hub: version details, enabled
 * modules, attribution to gjs.market, and links to documentation and
 * development services.
 */
export class AboutModule implements DevtoolsModule {
  readonly id = 'about';
  readonly title = 'About';
  private readonly ctx: ModuleContext;

  constructor(ctx: ModuleContext) {
    this.ctx = ctx;
  }

  mount(el: HTMLElement): void {
    const gjsVersion = this.grapesVersion();

    const modules = this.ctx.options.modules;

    el.appendChild(
      h(
        'div',
        { class: 'gjs-dt-about' },
        h('h3', { text: 'grapesjs-devtools' }),
        h('div', {
          class: 'gjs-dt-muted',
          text: 'Developer panel for GrapesJS — inspect, log, evaluate.',
        }),

        h(
          'dl',
          {},
          h('dt', { text: 'Plugin version' }),
          h('dd', {}, h('code', { text: PLUGIN_VERSION })),
          h('dt', { text: 'GrapesJS version' }),
          h('dd', {}, h('code', { text: String(gjsVersion) })),
          h('dt', { text: 'Theme' }),
          h('dd', { text: this.ctx.options.theme }),
          h('dt', { text: 'Hotkey' }),
          h('dd', {}, h('code', { text: this.formatHotkey(this.ctx.options.hotkey) })),
        ),

        h('h4', { class: 'gjs-dt-muted', text: 'Enabled modules' }),
        h(
          'div',
          {},
          ...modules.map((m) => h('span', { class: 'gjs-dt-badge', text: m })),
        ),

        // ── Help / development services ────────────────────────────────
        h(
          'div',
          { class: 'gjs-dt-about-help' },
          h('h4', { text: 'Need help?' }),
          h('div', {
            class: 'gjs-dt-muted',
            text: 'Custom GrapesJS development, plugins and integrations — from the team behind this plugin.',
          }),
          this.link(GJS_SERVICES, '💬 Development services →', 'gjs-dt-btn gjs-dt-about-cta'),
        ),

        // ── Links ─────────────────────────────────────────────────────
        h(
          'div',
          { class: 'gjs-dt-about-links' },
          this.link(GJS_PRODUCT, 'Plugin page'),
          this.link(REPO, 'GitHub'),
          this.link(GJS_MARKET, 'gjs.market'),
          this.link(GJS_SERVICES, 'Services'),
        ),

        // ── Attribution ───────────────────────────────────────────────
        h(
          'div',
          { class: 'gjs-dt-about-credit gjs-dt-muted' },
          'Built by ',
          this.link(GJS_MARKET, 'gjs.market', 'gjs-dt-link'),
          ' for the whole GrapesJS community. ♥',
        ),
      ),
    );
  }

  /**
   * Resolve the GrapesJS version of the editor that is *actually running*.
   *
   * `version` lives on the `grapesjs` **factory** (the object you call `.init()`
   * on), not on the editor instance — and the host may run a different factory
   * than the one bundled with this plugin. GrapesJS Studio, for example, ships
   * its own GrapesJS. So we pick the factory whose `editors` array contains this
   * editor and read *its* version, rather than trusting our static import.
   */
  private grapesVersion(): string {
    type Factory = { version?: unknown; editors?: unknown };
    const staticFactory = grapesjs as unknown as Factory;
    const globalFactory = (globalThis as unknown as { grapesjs?: Factory })
      .grapesjs;
    // Global first: in Studio the page global is the factory that owns the editor.
    const candidates = [globalFactory, staticFactory].filter(
      (f): f is Factory => !!f,
    );

    const owns = (f: Factory): boolean =>
      Array.isArray(f.editors) && f.editors.includes(this.ctx.editor);

    const owner = candidates.find((f) => owns(f) && f.version != null);
    const version =
      owner?.version ?? candidates.find((f) => f.version != null)?.version;
    return version != null ? String(version) : 'unknown';
  }

  /** Show the first hotkey combo, rendered with ⌘ on macOS. */
  private formatHotkey(hotkey: string): string {
    const first = hotkey.split(',')[0]?.trim() || hotkey;
    const isMac = /Mac|iPhone|iPad|iPod/i.test(
      navigator.platform || navigator.userAgent || '',
    );
    return isMac ? first.replace(/\bctrl\b/i, '⌘') : first;
  }

  private link(href: string, text: string, cls = 'gjs-dt-link'): HTMLElement {
    return h('a', {
      class: cls,
      href,
      text,
      attrs: { target: '_blank', rel: 'noopener noreferrer' },
    });
  }
}
