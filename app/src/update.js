// SPDX-License-Identifier: GPL-3.0-only
// Update of TasmoFlow.tapp from the light interface. The loader (the /tf page) found a newer
// version in the channel's manifest (latest.json on GitHub Pages) and put it in
// window.TASMOFLOW.update = { version, size, sha256, url }. Here: download the .tapp from Pages
// (a checked HTTPS connection), send it to the gateway in small pieces (the gateway needs no
// TLS), let it check and install it (extension/tf_update.be), then wait for it to restart.
import { html } from './html.js';
import { createStore } from './store.js';
import { t } from './i18n.js';
import { S, get, post, wake } from './state.js';
import { client } from './api.js';
import cfg from './config.js';

const CHUNK = 1500;                 // bytes per request: 2000 characters of base64, under the gateway's 3000
const WAIT_MS = 120000;             // the longest a restart is waited for (it takes 30 to 60 s)
const wait = () => window.__TF_UPDATE_WAIT || WAIT_MS;

// phase: idle | download | upload | restart | timeout | error
export const U = createStore({ phase: 'idle', done: 0, total: 0, elapsed: 0, error: '' });

const b64 = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(s);
};

async function send(info) {
  U.set({ phase: 'download', done: 0, total: 0, error: '' });
  const r = await fetch(info.url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' (download)');
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (info.size && bytes.length !== info.size) throw new Error(t('updateBadFile'));
  U.set({ phase: 'upload', done: 0, total: bytes.length });
  for (let off = 0; off < bytes.length; off += CHUNK) {
    await post('/api/update', { off, size: bytes.length }, b64(bytes.subarray(off, off + CHUNK)));
    U.set({ done: Math.min(bytes.length, off + CHUNK) });
  }
  await get('/api/update_apply', { size: bytes.length, sha256: info.sha256 });     // the gateway checks, installs, restarts
}

// waits for the gateway to answer again with the new version, or gives up after wait()
async function waitRestart(info) {
  const t0 = Date.now();
  const api = client(S.get().gw);
  U.set({ phase: 'restart', elapsed: 0 });
  while (Date.now() - t0 < wait()) {
    await new Promise(r => setTimeout(r, 2000));
    U.set({ elapsed: Math.round((Date.now() - t0) / 1000) });
    wake(S.get().gw);                                  // the API server only starts when something asks for /tf
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 2000);
      const st = await fetch(api.url('/api/status'), { signal: ctl.signal }).then(x => x.json());
      clearTimeout(timer);
      if (st.tasmoflow === info.version) { location.reload(); return; }       // the new version runs: reload
    } catch (e) { /* still restarting */ }
  }
  U.set({ phase: 'timeout' });
}

export async function runUpdate(info) {
  if (!window.confirm(t('updateConfirm'))) return;
  try {
    await send(info);
  } catch (e) {
    const code = String(e.message || e);
    U.set({ phase: 'error', error: t('update_' + code) === 'update_' + code ? code : t('update_' + code) });
    get('/api/update_abort').catch(() => {});
    return;
  }
  await waitRestart(info);
}

// the banner of the light interface (registered by main_lite.js)
export function UpdateBanner() {
  const info = cfg.update;
  const u = U.use();
  if (!info) return null;
  if (u.phase === 'idle' || u.phase === 'error') {
    return html`<p class="lite update" role="status">${t('updateAvailable').replace('{v}', info.version)}
      <button class="b primary" onClick=${() => runUpdate(info)}>${t('updateNow')}</button>
      <a class="b" href="/tf?u=0">${t('updateLater')}</a>
      ${u.phase === 'error' ? html`<span class="msg bad" role="alert">${u.error}</span>` : null}</p>`;
  }
  if (u.phase === 'timeout') {
    return html`<p class="lite update" role="alert">${t('updateTimeout')}
      <a class="b" href=${'http://' + location.hostname + '/'}>${t('updateHome')}</a></p>`;
  }
  const shown = u.phase === 'restart' ? t('updateRestart').replace('{s}', u.elapsed).replace('{max}', Math.round(wait() / 1000))
    : u.phase === 'upload' ? t('updateUpload') : t('updateDownload');
  return html`<div class="lite update" role="status"><span class="spin" aria-hidden="true"></span> ${shown}
    ${u.phase === 'upload' ? html`<progress max=${u.total} value=${u.done}></progress>` : null}</div>`;
}
