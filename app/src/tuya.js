// SPDX-License-Identifier: GPL-3.0-only
// Local Tuya devices, through the firmware's Tuya driver only (Tuya* commands, `Tuya` event).
// TasmoFlow never shows, stores or sends a local key: TuyaConfig already masks it.
import { html } from './html.js';
import { t } from './i18n.js';
import { cmd } from './state.js';
import { createStore } from './store.js';
import { controlsFor, sendName } from './tuya_model.js';

// the driver's answer to the last command of each device, when it was not "Done": { name: text }
const M = createStore({});

// the full interface may reshape the controls (tuya_colour.js sets `refine`); one with `render` is a component
export const EXTRA = {};

function Control({ c, node, send }) {
  if (c.render) return html`<${c.render} c=${c} node=${node} send=${send}/>`;
  const v = node.dps[c.dp];
  if (c.kind === 'read') {
    return html`<span>${c.label} <b>${v == null ? '?' : +(v / c.div).toFixed(2) + (c.unit ? ' ' + c.unit : '')}</b></span>`;
  }
  if (c.kind === 'switch') {
    const on = v === true;
    return html`<button class="b" aria-pressed=${on} disabled=${!node.connected} onClick=${() => send(c.dp, 'toggle')}>
      ${c.label + ' · ' + (on ? t('on') : t('off'))}</button>`;
  }
  const unknown = v == null ? ' ?' : '';      // the driver only keeps the DPs it uses (docs: `keep`)
  const low = c.percent ? (c.min ? 1 : 0) : c.min;     // a dimmer shows 1-100 % like the Tuya app (raw 10 = 1 %), never 0
  const pct = c.percent ? Math.round(low + ((v == null ? c.min : v) - c.min) / (c.max - c.min) * (100 - low)) : (v == null ? c.min : v);
  const top = c.percent ? 100 : c.max;
  return html`<label class="rng">${c.label + unknown + ' '}<input type="range" min=${low} max=${top} value=${pct} disabled=${!node.connected}
    aria-label=${c.label} onChange=${e => send(c.dp, c.percent ? Math.round(c.min + (+e.target.value - low) / (100 - low) * (c.max - c.min)) : +e.target.value)}/></label>`;
}

export function TuyaCard({ name, node, entry }) {
  const msg = M.get()[name];
  const setMsg = text => M.set({ [name]: text });
  const addr = sendName(name, entry);
  const send = (dp, value) => cmd('TuyaSend ' + addr + ',' + dp + ',' + value).then(r => {
    const x = r.TuyaSend;
    setMsg(x === 'Done' ? null : typeof x === 'string' ? x : JSON.stringify(x));
  }).catch(e => setMsg(e.message));
  // a name with a comma and no known id (sub-device, or TuyaConfig not read): read only
  const base = controlsFor(node, entry);
  const cs = (EXTRA.refine ? EXTRA.refine(base, entry) : base).filter(c => addr || c.kind === 'read');
  const reads = cs.filter(c => c.kind === 'read');
  const acts = cs.filter(c => c.kind !== 'read');
  return html`<article class="card">
    <h3>${name}</h3>
    <div class="q">${'Tuya · ' + node.ip + ' · ' + node.version + ' · ' + (node.connected ? t('connected') : t('disconnected'))}</div>
    ${reads.length ? html`<div class="st">${reads.map(c => html`<${Control} c=${c} node=${node} send=${send}/>`)}</div>` : null}
    ${acts.length ? html`<div class="row tight">${acts.map(c => html`<${Control} c=${c} node=${node} send=${send}/>`)}</div>` : null}
    ${msg ? html`<div class="msg bad" role="alert">${msg}</div>` : null}
  </article>`;
}

// the heading and the state of the driver, when it is not running, are in views.js (DriverNote)
export function TuyaSection({ tuya }) {
  const names = Object.keys(tuya.nodes).sort((a, b) => a.localeCompare(b));
  return html`${tuya.lowMem ? html`<p class="q">${t('tuyaLowMem')}</p>` : null}
    ${names.length ? html`<div class="grid">${names.map(n =>
      html`<${TuyaCard} key=${n} name=${n} node=${tuya.nodes[n]} entry=${tuya.conf && tuya.conf[n]}/>`)}</div>` : html`<p>${t('noDevice')}</p>`}`;
}
