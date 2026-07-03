type Mode = 'webpage' | 'studio';

/** Read the active mode from the URL (URL-as-state). Defaults to `webpage`. */
function readMode(): Mode {
  const mode = new URLSearchParams(location.search).get('mode');
  return mode === 'studio' ? 'studio' : 'webpage';
}

/**
 * Reflect the active mode on the segmented toggle. The buttons are plain
 * anchors (`?mode=…`), so switching is a full reload — the cleanest way to
 * swap between a classic GrapesJS editor and Studio's React app with no leaked
 * state. Clicking the already-active mode is a no-op.
 */
function wireToggle(active: Mode): void {
  const buttons = document.querySelectorAll<HTMLAnchorElement>('.demo-switch-btn');
  for (const btn of buttons) {
    const isActive = btn.dataset.mode === active;
    btn.setAttribute('aria-current', String(isActive));
    if (isActive) {
      btn.addEventListener('click', (e) => e.preventDefault());
    }
  }
}

async function main(): Promise<void> {
  const mode = readMode();
  wireToggle(mode);

  const container = document.getElementById('editor');
  if (!container) throw new Error('demo: #editor container not found');

  // Dynamic import so each mode only downloads its own editor bundle — the
  // heavy Studio SDK never loads in Webpage mode, and vice versa.
  if (mode === 'studio') {
    const { initStudio } = await import('./studio');
    await initStudio(container);
  } else {
    const { initWebpage } = await import('./webpage');
    initWebpage(container);
  }
}

void main();
