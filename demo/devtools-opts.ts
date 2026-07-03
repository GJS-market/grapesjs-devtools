import type { DevtoolsOptions } from '../src/index';

/** Shared devtools config so both editor modes attach the panel identically. */
export const DEVTOOLS_OPTS: DevtoolsOptions = {
  enabled: true,
  position: 'bottom',
  theme: 'dark',
};
