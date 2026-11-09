// SPDX-License-Identifier: GPL-3.0-only
import { useState, useEffect, useRef } from 'preact/hooks';
import { html } from './html.js';
import { t, L } from './i18n.js';
import { S, cmd, loadDevices } from './state.js';
import cfg from './config.js';

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
  const s = S.use();
  if (!s.devices) return html`<p>${t('loading')}</p>`;
  if (s.status && s.status.zigbee === false) return html`<p>${t('zigbeeOff')}</p>`;
  const list = Object.values(s.devices).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return html`
    <div class="row">
      <button class="b" onClick=${() => cmd('ZbPermitJoin 1')}>${t('pair')}</button>
      <button class="b" onClick=${loadDevices}>${t('refresh')}</button>
    </div>
    ${list.length ? html`<div class="grid">${list.map(d => html`<${ZigbeeCard} key=${d.addr} d=${d}/>`)}</div>` : html`<p>${t('noDevice')}</p>`}`;
}

export function EventsView() {
  const { events } = S.use();
  if (!events.length) return html`<p>${t('noEvent')}</p>`;
  const lang = L.get().lang;
  return html`<ol class="ev">${events.map(ev => html`<li key=${ev.seq}>
    <span class="q">${new Date(ev.ts * 1000).toLocaleTimeString(lang)} · </span><b>${ev.name || ev.device || ev.type}</b> ${JSON.stringify(ev.attrs || ev)}
  </li>`)}</ol>`;
}

export function ConsoleView() {
  const { consoleOut } = S.use();
  const [text, setText] = useState('');
  const input = useRef();
  useEffect(() => { input.current.focus(); }, []);
  const run = () => {
    const c = text.trim();
    if (!c) return;
    cmd(c).then(r => S.set({ consoleOut: '> ' + c + '\n' + JSON.stringify(r, null, 2) }))
      .catch(e => S.set({ consoleOut: '> ' + c + '\n' + t('error') + ' : ' + e.message }));
  };
  return html`
    <div class="row">
      <input ref=${input} value=${text} aria-label=${t('cmdPlaceholder')} placeholder=${t('cmdPlaceholder')}
        onInput=${e => setText(e.target.value)} onKeyDown=${e => e.key === 'Enter' && run()}/>
      <button class="b" onClick=${run}>${t('send')}</button>
    </div>
    <pre>${consoleOut}</pre>`;
}

export function DiagView() {
  const s = S.use();
  const st = s.status;
  if (!st) return html`<p>${t('loading')}</p>`;
  const mem = st.memory || {};
  return html`
    <dl>
      <dt>${t('gateway')}</dt><dd>${s.gw.api}</dd>
      <dt>${t('source')}</dt><dd>${cfg.source + (cfg.source === 'github' ? ' (' + cfg.cdn + ')' : '')}</dd>
      <dt>${t('loadTime')}</dt><dd>${Math.round(s.startMs)} ms</dd>
      <dt>${t('heap')}</dt><dd>${mem.heap_free != null ? mem.heap_free + ' Ko' : '?'}</dd>
      <dt>${t('ufs')}</dt><dd>${st.ufs_free_kb != null ? st.ufs_free_kb + ' / ' + st.ufs_size_kb + ' Ko' : '?'}</dd>
    </dl>
    <h3>/api/status</h3>
    <pre>${JSON.stringify(st, null, 2)}</pre>`;
}
