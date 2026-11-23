// SPDX-License-Identifier: GPL-3.0-only
// Update of TasmoFlow.tapp, and the local copy of the interface. Both go to the gateway this page
// was opened from (LOCAL), whichever gateway is shown.
//
// Update: the channel's manifest (latest.json on GitHub Pages, cfg.upd) names the latest version;
// when it is another one (see newer()), a banner offers it. One click: download the .tapp from Pages
// (a checked HTTPS connection), send it to the gateway in small pieces (the gateway needs no TLS),
// let it check and install it (extension/tf_update.be), then wait for it to restart.
//
// Local copy: app.js.gz of this very version, next to app.js on Pages, saved on the gateway the
// same way (`f=js`); the gateway only keeps it if its SHA-256 is the one written into its .tapp.
// The /tf page then loads it before GitHub, and without internet access. After an update of the
// .tapp the copy is another version's: the page loads GitHub and saves the new copy by itself.
import { html } from './html.js';
import { createStore } from './store.js';
import { t } from './i18n.js';
import { S, LOCAL, wake, loadStatus } from './state.js';
import { client } from './api.js';
import cfg from './config.js';

export const CHUNK = 1500;                 // bytes per request: 2000 characters of base64, under the gateway's 3000
const WAIT_MS = 120000;             // the longest a restart is waited for (it takes 30 to 60 s)
const wait = () => window.__TF_UPDATE_WAIT || WAIT_MS;
const api = client(LOCAL);

// update: info (the manifest, with url, when another version is offered);
// phase: idle | later | download | upload | restart | timeout | error
export const U = createStore({ info: null, phase: 'idle', done: 0, total: 0, elapsed: 0, error: '' });
// local copy: phase '' | busy | error
export const C = createStore({ phase: '', done: 0, total: 0, error: '' });

export const b64 = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(s);
};

const kb = n => Math.ceil(n / 1024);

// Is the manifest's version `a` one to offer to a gateway running `b`? A test build offers any other
// commit; a release, only a higher version.
export function newer(a, b) {
  if (/-dev/.test(b)) return a !== b;
  a = a.split('.'); b = b.split('.');
  for (let i = 0; i < 3; i++) { const x = +a[i] || 0, y = +b[i] || 0; if (x !== y) return x > y; }
  return false;
}

// the text of an error: copy_<code> or update_<code> when there is one, then its detail
function errText(e, copy) {
  const code = String(e.message || e);
  const k = [copy && 'copy_' + code, 'update_' + code].find(x => x && t(x) !== x);
  return (k ? t(k) : code) + (e.detail ? ' ' + e.detail : '');
}

// room on the gateway for `size` bytes, before anything is downloaded or sent
async function room(size, f) {
  const r = await api.get('/api/update_check', f ? { size, f } : { size });
  if (!r.room) {
    const e = new Error('space');
    e.detail = t(f ? 'copySpaceDetail' : 'updateSpaceDetail').replace('{need}', kb(r.need)).replace('{size}', kb(size))
      .replace('{free}', kb(r.free + r.stale + (f ? r.js : r.bak))).replace('{bak}', kb(r.bak));
    throw e;
  }
}

// A timestamp in the query: `cache: 'no-store'` only skips the browser's cache, GitHub Pages' CDN
// still serves its own copy for up to 10 minutes (Cache-Control: max-age=600). A test build keeps the
// same paths (dev/latest.json, dev/TasmoFlow.tapp, dev/app.js.gz): a stale manifest with a new .tapp
// (or the reverse) failed the size check ("the downloaded file does not have the announced size").
export const fresh = url => url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();

async function download(url) {
  const r = await fetch(fresh(url), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' (download)');
  return new Uint8Array(await r.arrayBuffer());
}

// the file to the gateway in pieces, then its checks (and, for a .tapp, the install and the restart)
async function push(bytes, q, progress) {
  for (let off = 0; off < bytes.length; off += CHUNK) {
    await api.post('/api/update', { off, size: bytes.length, ...q }, b64(bytes.subarray(off, off + CHUNK)));
    progress(Math.min(bytes.length, off + CHUNK));
  }
  await api.get('/api/update_apply', { size: bytes.length, ...q });
}

// waits for the gateway to answer again with the new version, or gives up after wait()
async function waitRestart(info) {
  const t0 = Date.now();
  U.set({ phase: 'restart', elapsed: 0 });
  while (Date.now() - t0 < wait()) {
    await new Promise(r => setTimeout(r, 2000));
    U.set({ elapsed: Math.round((Date.now() - t0) / 1000) });
    wake(LOCAL);                                       // the API server only starts when something asks for /tf
    try {
      const st = await fetch(api.url('/api/status'), { signal: AbortSignal.timeout(2000) }).then(x => x.json());
      if (st.tasmoflow === info.version) { location.reload(); return; }       // the new version runs: reload
    } catch (e) { /* still restarting */ }
  }
  U.set({ phase: 'timeout' });
}

// the click on "Update" is the consent: no second question
export async function runUpdate(info) {
  try {
    U.set({ phase: 'download', done: 0, total: 0, error: '' });
    await room(info.size);
    const bytes = await download(info.url);
    if (info.size && bytes.length !== info.size) throw new Error(t('updateBadFile'));
    U.set({ phase: 'upload', done: 0, total: bytes.length });
    await push(bytes, { sha256: info.sha256 }, done => U.set({ done }));
  } catch (e) {
    U.set({ phase: 'error', error: errText(e) });
    api.get('/api/update_abort').catch(() => {});
    return;
  }
  await waitRestart(info);
}

export async function saveCopy() {
  C.set({ phase: 'busy', done: 0, total: 0, error: '' });
  try {
    const bytes = await download(cfg.cdn.split('?')[0] + '.gz');      // app.js.gz next to app.js
    await room(bytes.length, 'js');
    C.set({ total: bytes.length });
    await push(bytes, { f: 'js' }, done => C.set({ done }));
    C.set({ phase: '' });
  } catch (e) {
    C.set({ phase: 'error', error: errText(e, true) });
    api.get('/api/update_abort', { f: 'js' }).catch(() => {});
  }
  if (S.get().gw === LOCAL) loadStatus();             // its `copy` state
}

export async function dropCopy() {
  try { await api.get('/api/update_drop'); C.set({ phase: '', error: '' }); } catch (e) { C.set({ phase: 'error', error: errText(e, true) }); }
  if (S.get().gw === LOCAL) loadStatus();
}

// At start-up: is another version offered? And a local copy of another version (the .tapp was
// updated since) is replaced by this one, unless an update is on offer (the copy would follow it).
export async function initUpdate() {
  if (cfg.upd) {
    try {
      const j = await (await fetch(fresh(cfg.upd), { cache: 'no-store' })).json();
      if (j && j.version && newer(j.version, cfg.version)) U.set({ info: { ...j, url: new URL(j.tapp, cfg.upd).href } });
    } catch (e) { /* GitHub unreachable: nothing to offer */ }
  }
  if (cfg.copy === 2 && cfg.source === 'github' && !U.get().info) saveCopy();
}

// the update banner, above every screen while the page's own gateway is shown
export function UpdateBanner() {
  const u = U.get();
  const info = u.info;
  if (!info || u.phase === 'later' || S.get().gw !== LOCAL) return null;
  if (u.phase === 'idle' || u.phase === 'error') {
    return html`<p class="note update" role="status">${t('updateAvailable').replace('{v}', info.version)}
      <button class="b primary" onClick=${() => runUpdate(info)}>${t('updateNow')}</button>
      <button class="b" onClick=${() => U.set({ phase: 'later' })}>${t('updateLater')}</button>
      ${u.phase === 'error' ? html`<span class="msg bad" role="alert">${u.error}</span>` : null}</p>`;
  }
  if (u.phase === 'timeout') {
    return html`<p class="note update" role="alert">${t('updateTimeout')}
      <a class="b" href=${'http://' + location.hostname + '/'}>${t('updateHome')}</a></p>`;
  }
  const shown = u.phase === 'restart' ? t('updateRestart').replace('{s}', u.elapsed).replace('{max}', Math.round(wait() / 1000))
    : u.phase === 'upload' ? t('updateUpload') : t('updateDownload');
  return html`<div class="note update" role="status"><span class="spin" aria-hidden="true"></span> ${shown}
    ${u.phase === 'upload' ? html`<progress max=${u.total} value=${u.done}></progress>` : null}</div>`;
}

// Diagnostics screen: the local copy of the page's own gateway. `copy` comes with the status (an
// extension older than 18 November 2026 has none: nothing shown).
export function CopyPanel() {
  const s = S.get();
  const state = s.status && s.status.copy;
  if (s.gw !== LOCAL || state == null) return null;
  const c = C.get();
  return html`<section aria-label=${t('copyTitle')}>
    <h3>${t('copyTitle')}</h3>
    <p class="q">${t(['copyNone', 'copyOk', 'copyOld'][state])}</p>
    ${c.phase === 'busy' ? html`<div class="note update" role="status"><span class="spin" aria-hidden="true"></span> ${t('copyBusy')}
        <progress max=${c.total} value=${c.done}></progress></div>`
      : html`<div class="row">
        <button class="b primary" onClick=${saveCopy}>${t(state === 1 ? 'copyAgain' : 'copySave')}</button>
        ${state ? html`<button class="b" onClick=${dropCopy}>${t('copyDrop')}</button>` : null}</div>`}
    ${c.phase === 'error' ? html`<p class="msg bad" role="alert">${c.error}</p>` : null}
  </section>`;
}
