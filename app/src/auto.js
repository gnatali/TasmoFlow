// SPDX-License-Identifier: GPL-3.0-only
// TasmoFlow automations, the gateway's side seen from the interface: read the automations and the
// engine's state (/api/automations), save them (tf_auto.json, the source of truth, and the Berry
// generated from it, auto_gen.js), restore the previous version. The API is extension/tf_auto.be;
// files are sent in base64 pieces like an update (update.js), the gateway's request body being
// limited to 3 KB.
import { S, get, post, current } from './state.js';
import { b64, CHUNK } from './update.js';
import { generate } from './auto_gen.js';

// { loaded, error, bak, autos } in the state (`autos`), or { failed } when the gateway does not
// know the route (a .tapp older than 23 November 2026)
export function loadAutos() {
  const gw = S.get().gw;
  return get('/api/automations').then(r => {
    if (!current(gw)) return;
    S.set({ autos: r && r.ok ? { loaded: !!r.loaded, error: r.error || null, bak: !!r.bak, list: Array.isArray(r.autos) ? r.autos : [] } : { failed: (r && r.error) || 'route' } });
  }).catch(e => { if (current(gw)) S.set({ autos: { failed: e.message } }); });
}

async function send(f, text) {
  const bytes = new TextEncoder().encode(text);
  for (let off = 0; off < bytes.length; off += CHUNK) {
    await post('/api/automations_put', { f, off, size: bytes.length }, b64(bytes.subarray(off, off + CHUNK)));
  }
  return bytes.length;
}

// Saves `list` (the automations), and the Berry generated from it; the gateway checks that the Berry
// compiles, keeps the previous version and starts the new one. Throws the gateway's error.
export async function saveAutos(list) {
  const json = JSON.stringify(list);
  const be = generate(list);
  const sj = await send('json', json);
  const sb = await send('be', be);
  const r = await get('/api/automations_apply', { json: sj, be: sb });
  if (!r || !r.ok) throw new Error((r && r.error) || 'apply');
  await loadAutos();
}

export async function restoreAutos() {
  const r = await get('/api/automations_restore');
  if (!r || !r.ok) throw new Error((r && r.error) || 'restore');
  await loadAutos();
}
