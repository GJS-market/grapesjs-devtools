import grapesjs, { type Editor } from 'grapesjs';
import 'grapesjs/dist/css/grapes.min.css';
// @ts-expect-error — grapesjs-preset-webpage ships no bundled types.
import presetWebpage from 'grapesjs-preset-webpage';
import devtools from '../src/index';
import { DEVTOOLS_OPTS } from './devtools-opts';

const STARTER_HTML = `
  <section style="padding:56px 24px;font-family:system-ui,sans-serif;text-align:center">
    <h1 style="font-size:40px;margin:0 0 12px">Standard Webpage preset</h1>
    <p style="max-width:560px;margin:0 auto;color:#555;line-height:1.6">
      This is a classic <code>grapesjs.init()</code> editor with
      <strong>grapesjs-preset-webpage</strong>. The grapesjs-devtools panel is
      attached — open it with <kbd>Ctrl/⌘ + Shift + D</kbd>.
    </p>
  </section>
`;

/** Initialise the classic GrapesJS editor with the Webpage preset + devtools. */
export function initWebpage(container: HTMLElement): Editor {
  const editor = grapesjs.init({
    container,
    height: '100%',
    fromElement: false,
    storageManager: false,
    components: STARTER_HTML,
    plugins: [
      presetWebpage,
      (ed: Editor) => devtools(ed, DEVTOOLS_OPTS),
    ],
  });

  // Expose for manual poking in the console.
  (window as unknown as { editor: Editor }).editor = editor;
  return editor;
}
