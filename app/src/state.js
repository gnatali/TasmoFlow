// SPDX-License-Identifier: GPL-3.0-only
// Application state: current gateway, devices, event stream.
import { createStore } from './store.js';
import { client } from './api.js';
import cfg from './config.js';
import { loadRemotes, saveRemotes } from './remotes.js';

const T0 = performance.now();
export const LOCAL = { id: 'local', name: '', api: cfg.api, token: cfg.token };

export const S = createStore({
  tab: 'devices',
  gws: loadRemotes(),       // other gateways: [{ id, name, api, token }]
  gw: LOCAL,                // gateway shown
  status: null,
  devices: null,            // { "0x1234": { addr, name, model, ..., attrs: {} } }
  events: [],
  live: false,
  error: null,
  startMs: 0,
  consoleOut: ''
});

let api = client(LOCAL);
let es = null;
let lastSeq = 0;

export const cmd = c => api.cmd(c);
export const current = gw => S.get().gw === gw;
const fail = (gw, e) => { if (current(gw)) S.set({ error: e.message }); };

export function loadStatus() {
  const gw = S.get().gw;
  return api.get('/api/status').then(status => { if (current(gw)) S.set({ status, error: null }); })
    .catch(e => fail(gw, e));
}

export function loadDevices() {
  const gw = S.get().gw;
  return api.get('/api/devices').then(list => {
    const devices = {};
    list.forEach(d => { d.attrs = d.info || {}; devices[d.addr] = d; });
    if (current(gw)) S.set({ devices });
  }).catch(e => fail(gw, e));
}

// A gateway's API server only runs while an interface is open (memory): the main server's
// /tf?w=1 starts it. The answer is opaque (no CORS on port 80), only the effect matters.
function wake(gw) {
  fetch('http://' + new URL(gw.api).hostname + '/tf?w=1', { mode: 'no-cors' }).catch(() => {});
}

// Status of a gateway, waking its API server first if another interface did not open it.
export async function reach(gw, onWake) {
  const a = client(gw);
  for (let i = 0; ; i++) {
    try { return await a.get('/api/status'); } catch (e) {
      if (gw.id === 'local' || i >= 5) throw e;
      if (i === 0) { wake(gw); if (onWake) onWake(); }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

function closeEvents() {
  if (es) es.close();
  es = null;
}

function connectEvents() {
  closeEvents();
  const gw = S.get().gw;
  es = new EventSource(api.url('/api/events', { since: lastSeq }));
  es.onopen = () => S.set({ live: true });
  es.onerror = () => S.set({ live: false });
  es.onmessage = m => {
    let ev;
    try { ev = JSON.parse(m.data); } catch (e) { return; }
    if (!current(gw) || ev.seq <= lastSeq) return;      // already received before a reconnection
    lastSeq = ev.seq;
    let unknown = false;
    S.set(s => {
      const events = [ev, ...s.events].slice(0, 100);
      let devices = s.devices;
      if (ev.type === 'zigbee' && devices) {
        const d = devices[ev.device];
        if (d) {
          devices = { ...devices, [ev.device]: { ...d, attrs: { ...d.attrs, ...ev.attrs },
            lqi: ev.attrs.LinkQuality != null ? ev.attrs.LinkQuality : d.lqi, seenAt: Date.now() } };
        } else unknown = true;
      }
      return { events, devices };
    });
    if (unknown) loadDevices();                         // new or renamed device
  };
}

function start() {
  const gw = S.get().gw;
  return reach(gw).then(status => {
    if (!current(gw)) return;
    S.set({ status, error: null });
    return loadDevices();
  }).then(() => {
    if (!current(gw)) return;
    S.set({ startMs: performance.now() - T0 });
    connectEvents();
  }).catch(e => fail(gw, e));
}

export function selectGateway(id) {
  const gw = id === 'local' ? LOCAL : S.get().gws.find(g => g.id === id) || LOCAL;
  if (gw === S.get().gw) return;
  closeEvents();
  api = client(gw);
  lastSeq = 0;
  S.set({ gw, status: null, devices: null, events: [], live: false, error: null });
  start();
}

export function setTab(tab) {
  S.set({ tab });
  if (tab === 'diag') loadStatus();
}

export function addRemote(gw) {
  const gws = [...S.get().gws, gw];
  saveRemotes(gws);
  S.set({ gws });
}

export function removeRemote(id) {
  const gws = S.get().gws.filter(g => g.id !== id);
  saveRemotes(gws);
  if (S.get().gw.id === id) selectGateway('local');
  S.set({ gws });
}

export const init = start;
