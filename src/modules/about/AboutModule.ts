import grapesjs from 'grapesjs';
import type { DevtoolsModule, ModuleContext } from '../../types';
import { h } from '../../utils/dom';
import { PLUGIN_VERSION } from '../../version';

const GJS_MARKET = 'https://gjs.market';
const GJS_SERVICES = 'https://gjs.market/services';
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
    // GrapesJS exposes `version` on its default module export (the object you
    // call `.init()` on), not on the editor instance. Fall back to a UMD global
    // if some host exposes one, then to 'unknown'.
    const gjsVersion =
      (grapesjs as unknown as { version?: string }).version ??
      (globalThis as unknown as { grapesjs?: { version?: string } }).grapesjs
        ?.version ??
      'unknown';

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
