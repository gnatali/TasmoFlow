// SPDX-License-Identifier: GPL-3.0-only
// Test builds only (the Build workflow's `preview` job sets __BUILD__, tools/build_app.js): Eruda, a
// console and inspector inside the page (https://github.com/liriliri/eruda, MIT), to read errors and
// requests on a phone, where the browser has no developer tools. Its floating button opens it. Loaded
// from jsDelivr at a pinned version with its SRI hash; a release never loads it.
const ERUDA = 'https://cdn.jsdelivr.net/npm/eruda@3.4.3/eruda.js';
const ERUDA_SRI = 'sha384-weDBY9jeIj4NqaiZF9f6PMAMMY4lIu+0CAI+TjBIE73RctCQOxDoEHltYnstRszI';

export function loadDevtools() {
  if (!__BUILD__ || window.eruda) return;
  const s = document.createElement('script');
  s.src = ERUDA;
  s.integrity = ERUDA_SRI;
  s.crossOrigin = 'anonymous';
  s.onload = () => { try { window.eruda.init(); } catch (e) { console.warn('eruda', e); } };
  s.onerror = () => console.warn('eruda: not loaded (offline?)');
  document.head.appendChild(s);
}
