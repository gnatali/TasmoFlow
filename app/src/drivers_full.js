// SPDX-License-Identifier: GPL-3.0-only
// Full interface only: while a driver of the gateway is starting (Zigbee, then the Tuya driver which
// waits for it, the network and memory), looks again every 5 seconds and enables the screen as soon
// as it runs, up to 2 minutes (a Zigbee that never starts, no GPIO, would otherwise ask forever). The
// light interface does none of it: it asks to reload the page (views.js, DriverNote).
import { S, loadStatus, loadTuya, loadDevices, detect, RECHECK_MAX } from './state.js';
import { onChange } from './store.js';

const EVERY = 5000;
let timer = 0;
let busy = false;

const waiting = d => d.zigbee === 'starting' || d.tuya === 'starting';

function check() {
  const s = S.get();
  if (timer || busy || !waiting(s.drivers) || s.recheck >= RECHECK_MAX) return;
  timer = setTimeout(tick, EVERY);
}

// only what is still starting is read again (loading the Tuya configuration costs memory)
async function tick() {
  timer = 0;
  busy = true;
  const gw = S.get().gw;
  const was = S.get().drivers;
  try {
    if (was.zigbee === 'starting') await loadStatus();
    if (was.tuya === 'starting') await loadTuya();
    if (S.get().gw === gw) {
      detect();
      if (was.zigbee === 'starting' && S.get().drivers.zigbee === 'running') await loadDevices();
      S.set(s => ({ recheck: s.recheck + 1 }));
    }
  } finally {
    busy = false;
    check();
  }
}

export function watchDrivers() { onChange(check); }
