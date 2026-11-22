// SPDX-License-Identifier: GPL-3.0-only
// The Tuya product catalogue, built from tuya-local's device files (MIT, https://github.com/make-all/tuya-local)
// by tools/build_catalogue.py and published on GitHub Pages next to the interface, under
// catalogue/v<CATALOGUE_FORMAT>/<TUYA_LOCAL_REF>/ (a path that never changes for a format and a commit:
// cached by the browser). The workflow reads both from this file. Offline (no GitHub), the sheets say the catalogue is out of reach.
import cfg from './config.js';
import { S } from './state.js';
import { sheetRows, matchProducts, confidence } from './sheet_model.js';

export const TUYA_LOCAL_REF = '1260db9d65ec5f101ac9086823d99b57b688f671';   // tuya-local, 19 November 2026
export const CATALOGUE_FORMAT = 2;      // tools/build_catalogue.py's format: 2 adds `ro` (read-only DP)

// the catalogue's folder, from the address of the interface on GitHub Pages (.../vX.Y.Z/app.js or
// .../dev/app.js): null when the interface does not come from there
export function catalogueUrl() {
  if (!cfg.cdn) return null;
  try { return new URL('../catalogue/v' + CATALOGUE_FORMAT + '/' + TUYA_LOCAL_REF + '/', cfg.cdn.split('?')[0]).href; } catch (e) { return null; }
}

// the tuya-local file a product comes from, for the link on the sheet
export const sourceUrl = stem => 'https://github.com/make-all/tuya-local/blob/' + TUYA_LOCAL_REF + '/custom_components/tuya_local/devices/' + stem + '.yaml';

const memo = {};
const get = path => {
  const base = catalogueUrl();
  if (!base) return Promise.reject(new Error('offline'));
  if (!memo[path]) {
    memo[path] = fetch(base + path).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    memo[path].catch(() => { delete memo[path]; });       // a failure is tried again next time
  }
  return memo[path];
};

// { ref, files: [[stem, name, [dp, ...], [product id, ...]]] }
export const loadIndex = () => get('index.json');
// { name, products: [{ id, manufacturer, model }], dps: { "<dp>": { type, names, unit, min, max, scale, step, values } } }
export const loadProduct = stem => get('d/' + encodeURIComponent(stem) + '.json');

// The catalogue entry of each Tuya device, for the rule pickers: { "<device name>": { stem, name,
// products, dps } }, kept in the state (`products`). Only a probable or possible match (sheet_model.js,
// matchProducts, confidence), the same as the details sheet's first one. Out of reach: nothing, the
// pickers keep the codes alone.
export async function loadProducts() {
  const s = S.get();
  const tuya = s.tuya;
  if (!tuya || tuya.state !== 'running') return;
  let index;
  try { index = await loadIndex(); } catch (e) { return; }
  const out = {};
  for (const name in tuya.nodes) {
    const entry = (tuya.conf || {})[name];
    const key = entry && entry.id ? s.productKeys[entry.id] : null;
    const m = matchProducts(index, sheetRows(entry, tuya.nodes[name]).map(r => r.dp), key, 1)[0];
    if (!m || confidence(m) === 'ts_uncertain') continue;
    try { out[name] = { ...(await loadProduct(m.stem)), stem: m.stem }; } catch (e) { /* that one only */ }
  }
  S.set({ products: out });
}
