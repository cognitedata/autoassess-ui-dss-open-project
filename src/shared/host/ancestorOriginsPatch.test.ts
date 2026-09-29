import { describe, expect, it } from 'vitest';

import { SAFE_ANCESTOR_ORIGINS_EXPR, patchAncestorOrigins } from './ancestorOriginsPatch';

/** Evaluate the replacement expression against a stubbed window/document. */
function evalExpr(win: unknown, doc: unknown): { length: number; 0?: string } {
  // Arrange/Act: the expression is plain ES5 and only touches window/document
  return new Function('window', 'document', `return ${SAFE_ANCESTOR_ORIGINS_EXPR};`)(win, doc);
}

// The unguarded code that @cognite/app-sdk ships (Firefox has no ancestorOrigins).
const APP_SDK_SNIPPET =
  'if (window.location.ancestorOrigins.length === 0 || window.location.ancestorOrigins.length > 2) throw Error("nope");\n' +
  'return window.location.ancestorOrigins[0];';

describe(patchAncestorOrigins.name, () => {
  it('should replace every unguarded access', () => {
    const patched = patchAncestorOrigins(APP_SDK_SNIPPET);
    // All three original accesses are wrapped; none is left bare (a bare access is
    // exactly the needle NOT followed by our fallback marker `||`).
    expect(patched).not.toMatch(/window\.location\.ancestorOrigins(?!\|\|)/);
    expect(patched.split(SAFE_ANCESTOR_ORIGINS_EXPR)).toHaveLength(4);
  });

  it('should leave code without the needle untouched', () => {
    expect(patchAncestorOrigins('const a = 1;')).toBe('const a = 1;');
  });

  it('should keep the native list when the browser has one', () => {
    const native = { length: 1, 0: 'https://fusion.cognite.com' };
    const out = evalExpr({ location: { ancestorOrigins: native } }, { referrer: '' });
    expect(out).toBe(native);
  });

  it('should fall back to the referrer origin on Firefox', () => {
    const out = evalExpr(
      { location: {} },
      { referrer: 'https://cog-autoassess.fusion.cognite.com/autoassess-dev/some/page' },
    );
    expect(out.length).toBe(1);
    expect(out[0]).toBe('https://cog-autoassess.fusion.cognite.com');
  });

  it('should yield an empty list when there is no referrer', () => {
    const out = evalExpr({ location: {} }, { referrer: '' });
    expect(out.length).toBe(0);
  });

  it('should make the patched app-sdk snippet work on a Firefox-like window', () => {
    const patched = patchAncestorOrigins(APP_SDK_SNIPPET);
    const run = new Function('window', 'document', patched);
    const origin = run({ location: {} }, { referrer: 'https://fusion.cognite.com/x' });
    expect(origin).toBe('https://fusion.cognite.com');
  });
});
