// SPDX-License-Identifier: GPL-3.0-only
// Devices screen (the other screens are in views_full.js)
import { useState } from 'preact/hooks';
import { html } from './html.js';
import { t } from './i18n.js';
import { S, run, loadStatus, loadDevices, loadTuya, detect, RECHECK_MAX } from './state.js';
import { TuyaSection, Msg } from './tuya.js';
import { RenameDialog } from './rename.js';
import { isAddr } from './rules_devices.js';

function ago(sec) {
  if (sec == null) return '?';
  const u = sec < 60 ? [sec, 's'] : sec < 3600 ? [Math.round(sec / 60), 'min'] :
    sec < 86400 ? [Math.round(sec / 3600), 'h'] : [Math.round(sec / 86400), 'd'];
  return (t('ago') ? t('ago') + ' ' : '') + u[0] + ' ' + t(u[1]);
}

// attributes shown first on a card
const MAIN_ATTRS = ['Power', 'Dimmer', 'Temperature', 'Humidity', 'Pressure', 'Illuminance',
  'Occupancy', 'Contact', 'Water', 'Action', 'Click', 'BatteryPercentage'];
const hasPower = d => Object.keys(d.attrs).some(k => /^Power\d*$/.test(k));

// A driver that is not running: its functions are off, and this says why. Nothing for an absent
// one (not in this firmware). The interface looks again by itself while the driver starts
// (drivers_full.js), and says so.
function DriverNote({ id }) {
  const s = S.get();
  const st = s.drivers[id];
  if (!st || st === 'running' || st === 'absent') return null;
  const auto = st === 'starting' && s.recheck < RECHECK_MAX;
  const msg = auto ? 'driverAuto' : st === 'disabled' ? 'driverDisabled' : 'driverGaveUp';
  return html`<p class="note" role="status">${t(msg).replace('{d}', id === 'zigbee' ? 'Zigbee' : 'Tuya') + (s.drivers.tuyaWhy && id === 'tuya' && st === 'starting' ? ' (' + s.drivers.tuyaWhy + ')' : '')}
    ${auto || st === 'disabled' ? null : html`<button class="b" onClick=${() => S.set({ recheck: 0 })}>${t('retry')}</button>`}</p>`;
}

function ZigbeeCard({ d }) {
  const since = d.seenAt ? Math.round((Date.now() - d.seenAt) / 1000) : d.lastseen;
  const shown = MAIN_ATTRS.filter(k => d.attrs[k] != null);
  const [ren, setRen] = useState(false);
  const name = d.name && !isAddr(d.name) ? d.name : '';
  return html`<article class="card">
    <h3>${d.name || d.addr}</h3>
    <div class="q">${[d.model, d.manufacturer].filter(Boolean).join(' · ') || d.addr}</div>
    <div class="st">${shown.map(k => html`<span>${k} <b>${typeof d.attrs[k] === 'object' ? JSON.stringify(d.attrs[k]) : String(d.attrs[k])}</b></span>`)}</div>
    <div class="q">${'LQI ' + (d.lqi != null ? d.lqi : '?') + ' · ' + t('lastSeen') + ' ' + ago(since) +
      (d.battery != null && d.battery >= 0 ? ' · ' + t('battery') + ' ' + d.battery + ' %' : '') +
      (d.reachable === false ? ' · ' + t('unreachable') : '') +
      ' · ' + (d.router ? t('router') : t('endDevice'))}</div>
    <div class="row tight">
      ${hasPower(d) ? html`<button class="b" onClick=${() => run(d.addr, 'ZbSend {"device":"' + d.addr + '","send":{"Power":"Toggle"}}')}>${t('toggle')}</button>` : null}
      <button class="b" aria-label=${t('rn_title') + ' ' + (name || d.addr)} onClick=${() => setRen(true)}>${t('rn_title')}</button>
    </div>
    <${Msg} k=${d.addr}/>
    ${ren ? html`<${RenameDialog} kind="zigbee" addr=${d.addr} name=${name} onClose=${() => setRen(false)}/>` : null}
  </article>`;
}

export function DevicesView() {
  const s = S.get();
  if (!s.devices) return html`<p>${t('loading')}</p>`;
  const dr = s.drivers;
  const zb = dr.zigbee === 'running';
  const list = Object.values(s.devices).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const tuya = dr.tuya && dr.tuya !== 'absent';
  const refresh = async () => {
    await loadStatus();
    await Promise.all([loadDevices(), loadTuya()]);
    detect();
    S.set({ recheck: 0 });
  };
  return html`
    <div class="row">
      ${dr.zigbee !== 'absent' ? html`<button class="b" disabled=${!zb} onClick=${() => run('pair', 'ZbPermitJoin 1')}>${t('pair')}</button>` : null}
      <button class="b" onClick=${refresh}>${t('refresh')}</button>
    </div>
    <${Msg} k="pair"/>
    ${tuya ? html`<h2>Zigbee</h2>` : null}
    <${DriverNote} id="zigbee"/>
    ${zb ? (list.length ? html`<div class="grid">${list.map(d => html`<${ZigbeeCard} key=${d.addr} d=${d}/>`)}</div>` : html`<p>${t('noDevice')}</p>`) : null}
    ${tuya ? html`<h2>Tuya</h2><${DriverNote} id="tuya"/>` : null}
    ${dr.tuya === 'running' ? html`<${TuyaSection} tuya=${s.tuya}/>` : null}`;
}
