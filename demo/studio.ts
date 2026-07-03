import { createStudioEditor } from '@grapesjs/studio-sdk';
import '@grapesjs/studio-sdk/style';
import type { Editor } from 'grapesjs';
import devtools from '../src/index';
import { DEVTOOLS_OPTS } from './devtools-opts';

/**
 * License key. Any value works on `localhost`; a real SDK license key is
 * required on public domains. On Netlify it is injected via the
 * `VITE_STUDIO_LICENSE_KEY` build-time environment variable.
 */
const LICENSE_KEY =
  import.meta.env.VITE_STUDIO_LICENSE_KEY ?? 'DEV_LICENSE_KEY';

const STARTER_HTML = `
  <section style="padding:56px 24px;font-family:system-ui,sans-serif;text-align:center">
    <h1 style="font-size:40px;margin:0 0 12px">GrapesJS Studio</h1>
    <p style="max-width:560px;margin:0 auto;color:#555;line-height:1.6">
      This is the <strong>@grapesjs/studio-sdk</strong> editor. The
      grapesjs-devtools panel is attached to the underlying editor — open it with
      <kbd>Ctrl/⌘ + Shift + D</kbd>.
    </p>
  </section>
`;

/** Handle returned to the demo orchestrator so it can tear the editor down. */
export interface StudioHandle {
  destroy(): void;
}

/** Initialise the GrapesJS Studio editor and attach devtools via `onEditor`. */
export async function initStudio(container: HTMLElement): Promise<StudioHandle> {
  let editor: Editor | undefined;

  await createStudioEditor({
    root: container,
    licenseKey: LICENSE_KEY,
    project: {
      type: 'web',
      default: {
        pages: [{ name: 'Home', component: STARTER_HTML }],
      },
    },
    // Fires with the underlying GrapesJS editor instance — attach devtools here.
    onEditor: (ed: Editor) => {
      editor = ed;
      devtools(ed, DEVTOOLS_OPTS);
      (window as unknown as { editor: Editor }).editor = ed;
    },
  });

  return {
    destroy: () => editor?.destroy(),
  };
}
