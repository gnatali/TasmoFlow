// SPDX-License-Identifier: GPL-3.0-only
// Application state: current gateway, devices, event stream. What the other screens show (rules,
// other gateways, diagnostics) is loaded by their own modules.
import { createStore } from './store.js';
import { client } from './api.js';
import cfg from './config.js';
import { indexConfig } from './tuya_model.js';
import { t } from './i18n.js';

const T0 = performance.now();
export const RECHECK_MAX = 24;                      // x 5 s: the full interface gives up after 2 minutes
export const LOCAL = { id: 'local', name: '', api: cfg.api, token: cfg.token };

// Tuya product ids found by TuyaScan, by device id (ids are unique across gateways): kept in the
// browser so that the scan is run once. Not secret (the local key is), never sent anywhere.
const KEYS = 'tf-product-keys';
function readKeys() { try { return JSON.parse(localStorage.getItem(KEYS)) || {}; } catch (e) { return {}; } }
function saveKeys(k) { try { localStorage.setItem(KEYS, JSON.stringify(k)); } catch (e) { /* private mode: for this page only */ } }

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
  stopped: false,           // the gateway stopped this page's event stream: more than three were open
  error: null,
  productKeys: readKeys(),
  autos: null,              // { loaded, error, bak, list } of the automations (auto.js), or { failed }
  products: null,           // { "<Tuya device>": its catalogue entry } for the rule pickers (catalogue.js, loadProducts)  // Tuya device id -> product id, from TuyaScan (the details sheet), kept in the browser
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

// A card's or a button's command: the answer, when it is not "Done" (refused, failed), is kept to
// show next to it, { key: text }; a command that succeeds clears it.
export const M = createStore({});
export const run = (key, c) => cmd(c).then(r => {
  const x = r[c.split(' ')[0]];
  // ZbSend to a device that does not answer: Tasmota's answer is {"0x1234":{"Reachable":false}}
  const gone = x == null && Object.values(r || {}).some(v => v && v.Reachable === false);
  M.set({ [key]: x === 'Done' ? null : gone ? t('noAnswer') : typeof x === 'string' ? x : JSON.stringify(x || r) });
}).catch(e => M.set({ [key]: e.message }));

// A Tuya command answered Done is only written to the device: the driver may not know yet that it was
// cut (it notices after 35 s without a frame, or 5 s without an answer with the firmware of 20 November
// 2026), and a sub-device of a Tuya gateway is never answered for. Without any event from the device
// NO_REPLY ms later, the card says it did not answer; its next event clears that.
const NO_REPLY = 5000;
const waits = {};                      // { device name: timer }
export const runTuya = (name, c) => run(name, c).then(() => {
  if (M.get()[name]) return;           // refused: the answer is already shown
  clearTimeout(waits[name]);
  waits[name] = setTimeout(() => { delete waits[name]; M.set({ [name]: t('noReply') }); }, NO_REPLY);
});
const heard = name => {
  if (waits[name]) { clearTimeout(waits[name]); delete waits[name]; }
  if (M.get()[name] === t('noReply')) M.set({ [name]: null });
};

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
// The configuration is read device by device (`TuyaConfig <name>`: since the firmware of 18 November
// 2026 the driver reads tuya.json entry by entry, with no memory threshold; a Tuya gateway's entry
// also brings its sub-devices), once per gateway, and again only for a device missing from it
// (added since). An older firmware loads the whole file for each and refuses below 30 KB free
// (lowMem), and finds no sub-device alone: then the whole configuration is read once.
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
    const conf = { ...(S.get().tuya || {}).conf };
    let lowMem = false;
    const missing = () => Object.keys(nodes).filter(n => !conf[n]);
    for (const n of missing()) {
      if (conf[n]) continue;                              // brought by its gateway's entry
      const c = (await a.cmd('TuyaConfig ' + n)).TuyaConfig || {};
      if (c.name) Object.assign(conf, indexConfig({ devices: [c] }));
      else if (/memory/.test(c.Error)) lowMem = true;
    }
    if (!lowMem && missing().length) Object.assign(conf, indexConfig((await a.cmd('TuyaConfig')).TuyaConfig));
    set({ state: 'running', nodes, conf, lowMem });
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
  es.onopen = () => S.set({ live: true, stopped: false });
  // the gateway keeps three streams: a newer interface took this one's place. Reconnecting would
  // take another's, so the page waits for the user (resume())
  es.addEventListener('stop', () => { closeEvents(); S.set({ live: false, stopped: true }); });
  es.onerror = () => {
    es.onopen = start;      // back after a cut: events were missed, read everything again
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
    if (ev.type === 'tuyascan') {                       // the discovery's result (tasmoflow.be, since 22 November 2026)
      const productKeys = { ...S.get().productKeys };
      for (const d of ev.devices || []) if (d && d.id && d.product_key) productKeys[d.id] = d.product_key;
      saveKeys(productKeys);
      S.set({ productKeys, scanAt: Date.now(), products: null });   // matched again with the product ids
    }
    S.set(s => {
      const events = [ev, ...s.events].slice(0, 100);
      let devices = s.devices;
      let tuya = s.tuya;
      // a DP change, or (since 18 November 2026) a connection change: the driver's TuyaConnected and
      // TuyaDisconnected, which a Tuya gateway's sub-devices follow
      if (ev.type === 'tuya' && tuya && tuya.nodes) {
        const n = tuya.nodes[ev.name];
        const on = ev.connected !== false;
        if (n) {
          const seen = { ...n.seen };                       // when each DP was last seen in an event (the details sheet)
          for (const k in ev.dps || {}) seen[k] = Date.now();
          const nodes = { ...tuya.nodes, [ev.name]: { ...n, connected: on, dps: { ...n.dps, ...ev.dps }, seen } };
          for (const c of ((tuya.conf || {})[ev.name] || {}).children || []) if (nodes[c.name]) nodes[c.name] = { ...nodes[c.name], connected: on };
          tuya = { ...tuya, nodes };
        } else unknownTuya = true;
      }
      if (ev.type === 'zigbee' && devices) {
        const d = devices[ev.device];
        // {"Reachable":false} comes from Tasmota itself when a command got no answer (Z_Unreachable,
        // xdrv_23_zigbee_6_0_commands.ino): not a sign of life; any other message is one
        if (d && ev.attrs.Reachable === false) devices = { ...devices, [ev.device]: { ...d, reachable: false } };
        else if (d) {
          const seen = { ...d.seen };                     // when each attribute was last seen in an event (the details sheet)
          for (const k in ev.attrs) seen[k] = Date.now();
          devices = { ...devices, [ev.device]: { ...d, attrs: { ...d.attrs, ...ev.attrs }, seen, reachable: true,
            lqi: ev.attrs.LinkQuality != null ? ev.attrs.LinkQuality : d.lqi, seenAt: Date.now() } };
        } else unknown = true;
      }
      return { events, devices, tuya };
    });
    if (ev.type === 'tuya') heard(ev.name);
    if (unknown) loadDevices();                         // new or renamed device
    if (unknownTuya) loadTuya();
  };
}

// Also run again when the event stream comes back after a cut. A restarted gateway numbers its
// events from 1 again: they would all be dropped as repeats until they pass the last number seen,
// so the stream starts over from 0 when the counter went back (if it already passed it, only the
// events in between are missing from the list; the devices are read again anyway).
function start() {
  const gw = S.get().gw;
  return reach(gw).then(status => {
    if (!current(gw)) return;
    if (status.events_seq < lastSeq) lastSeq = 0;
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
  S.set({ gw, status: null, devices: null, tuya: null, products: null, autos: null, drivers: {}, recheck: 0, rules: null, events: [], live: false, stopped: false, error: null });
  start();
}

export function setTab(tab) {
  if (tab === S.get().tab) { load(tab); return; }
  leave(() => { S.set({ tab }); load(tab); });
}

export const init = start;
export const resume = () => { if (!es) start(); };
