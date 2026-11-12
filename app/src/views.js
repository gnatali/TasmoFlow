// SPDX-License-Identifier: GPL-3.0-only
// Devices screen, the one both interfaces have (the others are in views_full.js)
import { html } from './html.js';
import { t } from './i18n.js';
import { S, cmd, loadDevices, loadTuya } from './state.js';
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
  const zigbee = !(s.status && s.status.zigbee === false);
  const list = Object.values(s.devices).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const tuya = s.tuya && s.tuya.state !== 'absent' && s.tuya.state !== 'disabled';
  return html`
    <div class="row">
      ${zigbee ? html`<button class="b" onClick=${() => cmd('ZbPermitJoin 1')}>${t('pair')}</button>` : null}
      <button class="b" onClick=${() => { loadDevices(); loadTuya(); }}>${t('refresh')}</button>
    </div>
    ${tuya ? html`<h2>Zigbee</h2>` : null}
    ${!zigbee ? html`<p>${t('zigbeeOff')}</p>` :
      list.length ? html`<div class="grid">${list.map(d => html`<${ZigbeeCard} key=${d.addr} d=${d}/>`)}</div>` : html`<p>${t('noDevice')}</p>`}
    <${TuyaSection} tuya=${s.tuya}/>`;
}
