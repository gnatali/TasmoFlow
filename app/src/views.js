// SPDX-License-Identifier: GPL-3.0-only
// Devices screen, the one both interfaces have (the others are in views_full.js)
import { html } from './html.js';
import { t } from './i18n.js';
import cfg from './config.js';
import { S, cmd, loadStatus, loadDevices, loadTuya, detect, RECHECK_MAX } from './state.js';
import { TuyaSection } from './tuya.js';

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
// one (not in this firmware). The light interface only invites to reload the page, whatever the
// reason; the full one looks again by itself while the driver starts (drivers_full.js), and says so.
function DriverNote({ id }) {
  const s = S.get();
  const st = s.drivers[id];
  if (!st || st === 'running' || st === 'absent') return null;
  const auto = !cfg.lite && st === 'starting' && s.recheck < RECHECK_MAX;
  const msg = cfg.lite ? 'driverLite' : auto ? 'driverAuto' : st === 'disabled' ? 'driverDisabled' : 'driverGaveUp';
  const retry = cfg.lite ? () => location.reload() : () => S.set({ recheck: 0 });
  return html`<p class="lite" role="status">${t(msg).replace('{d}', id === 'zigbee' ? 'Zigbee' : 'Tuya') + (s.drivers.tuyaWhy && id === 'tuya' && st === 'starting' ? ' (' + s.drivers.tuyaWhy + ')' : '')}
    ${auto || st === 'disabled' && !cfg.lite ? null : html`<button class="b" onClick=${retry}>${t(cfg.lite ? 'reload' : 'retry')}</button>`}</p>`;
}

function ZigbeeCard({ d }) {
  const since = d.seenAt ? Math.round((Date.now() - d.seenAt) / 1000) : d.lastseen;
  const shown = MAIN_ATTRS.filter(k => d.attrs[k] != null);
  return html`<article class="card">
    <h3>${d.name || d.addr}</h3>
    <div class="q">${[d.model, d.manufacturer].filter(Boolean).join(' · ') || d.addr}</div>
    <div class="st">${shown.map(k => html`<span>${k} <b>${typeof d.attrs[k] === 'object' ? JSON.stringify(d.attrs[k]) : String(d.attrs[k])}</b></span>`)}</div>
    <div class="q">${'LQI ' + (d.lqi != null ? d.lqi : '?') + ' · ' + t('lastSeen') + ' ' + ago(since) +
      (d.battery != null ? ' · ' + t('battery') + ' ' + d.battery + ' %' : '') +
      (d.reachable === false ? ' · ' + t('unreachable') : '') +
      ' · ' + (d.router ? t('router') : t('endDevice'))}</div>
    ${hasPower(d) ? html`<div class="row tight">
      <button class="b" onClick=${() => cmd('ZbSend {"device":"' + d.addr + '","send":{"Power":"Toggle"}}')}>${t('toggle')}</button>
    </div>` : null}
  </article>`;
}

export function DevicesView() {
  const s = S.get();
  if (!s.devices) return html`<p>${t('loading')}</p>`;
  const dr = s.drivers;
  const zb = dr.zigbee === 'running';
  const list = Object.values(s.devices).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const tuya = dr.tuya && dr.tuya !== 'absent';
  // the light interface keeps what it read when it opened: the page is reloaded to look again
  const refresh = async () => {
    if (!cfg.lite) await loadStatus();
    await Promise.all([loadDevices(), loadTuya()]);
    if (!cfg.lite) { detect(); S.set({ recheck: 0 }); }
  };
  return html`
    <div class="row">
      ${dr.zigbee !== 'absent' ? html`<button class="b" disabled=${!zb} onClick=${() => cmd('ZbPermitJoin 1')}>${t('pair')}</button>` : null}
      <button class="b" onClick=${refresh}>${t('refresh')}</button>
    </div>
    ${tuya ? html`<h2>Zigbee</h2>` : null}
    <${DriverNote} id="zigbee"/>
    ${zb ? (list.length ? html`<div class="grid">${list.map(d => html`<${ZigbeeCard} key=${d.addr} d=${d}/>`)}</div>` : html`<p>${t('noDevice')}</p>`) : null}
    ${tuya ? html`<h2>Tuya</h2><${DriverNote} id="tuya"/>` : null}
    ${dr.tuya === 'running' ? html`<${TuyaSection} tuya=${s.tuya}/>` : null}`;
}
