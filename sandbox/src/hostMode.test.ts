import { describe, expect, it, vi } from 'vitest';

import { createLiveDeps, detectHostMode } from './hostMode';

describe(detectHostMode.name, () => {
  it('should be standalone when not framed', () => {
    const win = { location: { search: '' } } as { self: unknown; top: unknown; location: { search: string } };
    win.self = win;
    win.top = win;

    expect(detectHostMode(win)).toBe('standalone');
  });

  it('should be fusion when framed', () => {
    expect(detectHostMode({ self: {}, top: {}, location: { search: '' } })).toBe('fusion');
  });

  it('should honour ?mode=demo even when framed', () => {
    expect(detectHostMode({ self: {}, top: {}, location: { search: '?mode=demo' } })).toBe('standalone');
  });
});

describe(createLiveDeps.name, () => {
  it('should offer the read-only CDF source first and demo data second', () => {
    const deps = createLiveDeps({ project: 'autoassess-dev', instances: { list: vi.fn() } });

    expect(deps.sources.map((s) => [s.mode, s.label])).toEqual([
      ['live', 'CDF project autoassess-dev (read-only)'],
      ['demo', 'Demo data (bundled)'],
    ]);
  });
});
