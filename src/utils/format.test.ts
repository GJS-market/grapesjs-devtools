import { describe, it, expect } from 'vitest';
import {
  formatTime,
  truncate,
  formatBytes,
  byteLength,
  escapeHtml,
  fileTimestamp,
} from './format';

describe('formatTime', () => {
  it('formats as HH:MM:SS.mmm with zero padding', () => {
    // Build a local-time date so the assertion is TZ-independent.
    const d = new Date(2020, 0, 1, 3, 5, 9, 7);
    expect(formatTime(d.getTime())).toBe('03:05:09.007');
  });
});

describe('truncate', () => {
  it('leaves short strings intact', () => {
    expect(truncate('abc', 5)).toBe('abc');
  });
  it('adds an ellipsis when too long', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
  });
});

describe('formatBytes', () => {
  it('formats B / KB / MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB');
  });
});

describe('byteLength', () => {
  it('counts UTF-8 bytes', () => {
    expect(byteLength('abc')).toBe(3);
    expect(byteLength('é')).toBe(2);
    expect(byteLength('😀')).toBe(4);
  });
});

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    expect(escapeHtml('<a href="x">&\'')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;',
    );
  });
});

describe('fileTimestamp', () => {
  it('produces YYYYMMDD-HHMMSS', () => {
    const d = new Date(2020, 0, 2, 3, 4, 5);
    expect(fileTimestamp(d.getTime())).toBe('20200102-030405');
  });
});
