/**
 * Firefox never implemented `window.location.ancestorOrigins` (a Chromium/WebKit
 * API), but `@cognite/app-sdk` (<= 0.10.0) reads it unguarded in
 * `getAncestorOrigin()` during the Fusion host handshake, so hosted apps crash
 * at startup on Firefox with "TypeError: window.location.ancestorOrigins is
 * undefined".
 *
 * Firefox's `Location` object is unforgeable, so a runtime polyfill cannot be
 * installed. Instead this build-time Vite plugin rewrites the dependency's
 * accesses to fall back to the embedding page's origin from `document.referrer`
 * (the Fusion host that frames the app). Remove once app-sdk guards the access.
 */
import type { Plugin } from 'vite';

/** DOMStringList-shaped fallback: the native list when present, else the referrer origin. */
export const SAFE_ANCESTOR_ORIGINS_EXPR =
  '(window.location.ancestorOrigins||(function(){var o="";' +
  'try{o=document.referrer?new URL(document.referrer).origin:""}catch(e){}' +
  'return o?{length:1,0:o,item:function(i){return i===0?o:null},contains:function(x){return x===o}}' +
  ':{length:0,item:function(){return null},contains:function(){return false}}})())';

const NEEDLE = 'window.location.ancestorOrigins';

/** Replace every bare access with the guarded expression (pure, unit-tested). */
export function patchAncestorOrigins(code: string): string {
  return code.split(NEEDLE).join(SAFE_ANCESTOR_ORIGINS_EXPR);
}

/** Vite plugin: applies the patch to @cognite/app-sdk modules at build time. */
export function ancestorOriginsFirefoxPlugin(): Plugin {
  return {
    name: 'patch-app-sdk-ancestor-origins',
    transform(code, id) {
      if (!id.includes('@cognite/app-sdk') || !code.includes(NEEDLE)) return null;
      return { code: patchAncestorOrigins(code), map: null };
    },
  };
}
