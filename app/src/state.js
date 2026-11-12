// SPDX-License-Identifier: GPL-3.0-only
// Application state: current gateway, devices, event stream. Shared by both interfaces: what only
// the full one shows (rules, other gateways, diagnostics) is loaded by its own modules, so the
// light bundle (main_lite.js) does not carry it.
import { createStore } from './store.js';
import { client } from './api.js';
import cfg from './config.js';
import { indexConfig, MIN_HEAP_KB } from './tuya_model.js';

const T0 = performance.now();
export const RECHECK_MAX = 24;                      // x 5 s: the full interface gives up after 2 minutes
export const LOCAL = { id: 'local', name: '', api: cfg.api, token: cfg.token };

export const S = createStore({
  tab: 'devices',
  gws: [],                  // other gateways: [{ id, name, api, token }] (full interface, gateways.js)
  gw: LOCAL,                // gateway shown
  status: null,
  devices: null,            // { "0x1234": { addr, name, model, ..., attrs: {} } }
  zbNames: false,           // SetOption83: Zigbee rule triggers carry the friendly name, not the address
  rules: null,              // { rules: [{ n, on, once, stop, len, free, text, bak }], berry: [{ rule, id }] }
  tuya: null,               // { state, detail, nodes: { name: { connected, ip, version, dps } }, conf, lowMem }
  drivers: {},              // detected at opening, see detect(): { zigbee, tuya: running|starting|disabled|absent, tuyaWhy }
  recheck: 0,               // full interface: detections made again while a driver starts (drivers_full.js)
  events: [],
  live: false,
  error: null,
  startMs: 0,
  consoleOut: ''
});

let api = client(LOCAL);
let es = null;
let lastSeq = 0;
let lastWake = 0;

export const cmd = c => api.cmd(c);
export const get = (path, params) => api.get(path, params);
export const post = (path, params, body) => api.post(path, params, body);
export const current = gw => S.get().gw === gw;
export const fail = (gw, e) => { if (current(gw)) S.set({ error: e.message }); };

// what a screen loads when it is shown, { tab: function }: registered by the full interface
// (diagnostics, rules), so the light one does not carry it
const loaders = {};
export const onTab = l => Object.assign(loaders, l);
const load = tab => { if (loaders[tab]) loaders[tab](); };

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

// Local Tuya devices: state of the firmware's driver, devices, then (memory permitting) their
// configuration, which tells what each DP means. Sequential: each command loads the driver's data.
export async function loadTuya() {
  const gw = S.get().gw;
  const a = api;
  const set = tuya => { if (current(gw)) S.set({ tuya }); };
  try {
    const e = (await a.cmd('TuyaEnable')).TuyaEnable;
    if (!e || typeof e !== 'object') return set({ state: 'absent' });      // {"Command":"Unknown"}
    if (!e.Enabled) return set({ state: 'disabled' });
    if (e.State !== 'running') return set({ state: 'waiting', detail: e.State });
    const nodes = {};
    const st = (await a.cmd('TuyaStatus')).TuyaStatus;
    for (const n in st || {}) {
      const d = st[n];
      nodes[n] = { connected: !!d.Connected, ip: d.Ip || '', version: d.Version || '', dps: d.Dps || {} };
    }
    const status = await a.get('/api/status');
    const heap = status.memory && status.memory.heap_free;
    let conf = null;
    if (heap == null || heap >= MIN_HEAP_KB) conf = indexConfig((await a.cmd('TuyaConfig')).TuyaConfig);
    set({ state: 'running', nodes, conf, lowMem: !conf });
  } catch (err) { fail(gw, err); }
}

// State of the drivers the interface relies on, read once the status and the Tuya state are loaded.
// Zigbee: the extension's `zigbee_state` (an older one only says started or not). Tuya: from
// TuyaEnable, `waiting` (the driver waits for Zigbee, the network, memory...) is `starting`.
// The light interface keeps what it read when it opened: it asks to reload the page, it never
// looks again (drivers_full.js does, in the full one).
export function detect() {
  S.set(s => {
    const st = s.status;
    const ty = s.tuya;
    return { drivers: {
      zigbee: st ? st.zigbee_state || (st.zigbee ? 'running' : 'starting') : null,
      tuya: ty ? (ty.state === 'waiting' ? 'starting' : ty.state) : null,
      tuyaWhy: ty && ty.detail
    } };
  });
}

// A gateway's API server only runs while an interface is open (memory): the main server's
// /tf?w=1 starts it. The answer is opaque (no CORS on port 80), only the effect matters.
export function wake(gw) {
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
  es.onerror = () => {
    S.set({ live: false });
    if (Date.now() - lastWake > 10000) { lastWake = Date.now(); wake(gw); }   // restarted gateway
  };
  es.onmessage = m => {
    let ev;
    try { ev = JSON.parse(m.data); } catch (e) { return; }
    if (!current(gw) || ev.seq <= lastSeq) return;      // already received before a reconnection
    lastSeq = ev.seq;
    let unknown = false;
    let unknownTuya = false;
    S.set(s => {
      const events = [ev, ...s.events].slice(0, 100);
      let devices = s.devices;
      let tuya = s.tuya;
      if (ev.type === 'tuya' && tuya && tuya.nodes) {
        const n = tuya.nodes[ev.name];
        if (n) tuya = { ...tuya, nodes: { ...tuya.nodes, [ev.name]: { ...n, connected: true, dps: { ...n.dps, ...ev.dps } } } };
        else unknownTuya = true;
      }
      if (ev.type === 'zigbee' && devices) {
        const d = devices[ev.device];
        if (d) {
          devices = { ...devices, [ev.device]: { ...d, attrs: { ...d.attrs, ...ev.attrs },
            lqi: ev.attrs.LinkQuality != null ? ev.attrs.LinkQuality : d.lqi, seenAt: Date.now() } };
        } else unknown = true;
      }
      return { events, devices, tuya };
    });
    if (unknown) loadDevices();                         // new or renamed device
    if (unknownTuya) loadTuya();
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
    if (S.get().tab !== 'diag') load(S.get().tab);   // diagnostics: the status was just read
    return loadTuya().then(detect);
  }).catch(e => fail(gw, e));
}

// A screen with work not saved yet (the rules, full interface) registers a function that asks and
// answers true to go on: it runs before the tab or the gateway changes.
let guard = null;
export const guardLeave = f => { guard = f; };
const leave = go => guard ? Promise.resolve(guard()).then(ok => { if (ok) go(); else S.set({}); }) : go();   // refused: draw again, a picker put back

export function selectGateway(id) {
  const gw = id === 'local' ? LOCAL : S.get().gws.find(g => g.id === id) || LOCAL;
  if (gw === S.get().gw) return;
  leave(() => switchTo(gw));
}

function switchTo(gw) {
  closeEvents();
  api = client(gw);
  lastSeq = 0;
  S.set({ gw, status: null, devices: null, tuya: null, drivers: {}, recheck: 0, rules: null, events: [], live: false, error: null });
  start();
}

export function setTab(tab) {
  if (tab === S.get().tab) { load(tab); return; }
  leave(() => { S.set({ tab }); load(tab); });
}

export const init = start;
