// SPDX-License-Identifier: GPL-3.0-only
// Details sheets, opened from a device's card: one layout for Zigbee and Tuya devices (both
// families are treated the same way): identity, link, one row per value (a Zigbee attribute, a
// Tuya DP) with what uses it and where the value comes from, then the rule sets that name the
// device. Read only. Each sheet reads its device again when it opens: `ZbStatus3 <address>`
// (the command's response) or `TuyaConfig <device>` (one entry, no lasting memory cost measured
// on 22 November 2026; the local key is masked by the firmware and never shown). The logic is in
// sheet_model.js.
import { useState, useEffect } from 'preact/hooks';
import { html } from './html.js';
import { t, L } from './i18n.js';
import { S, cmd } from './state.js';
import { loadRules } from './rules.js';
import { Modal } from './rules_modal.js';
import { sheetRows, identity, zbIdentity, zbLink, zbRows, ruleRefs, showValue } from './sheet_model.js';

// "12 min ago"
export function ago(sec) {
  if (sec == null) return '?';
  const u = sec < 60 ? [sec, 's'] : sec < 3600 ? [Math.round(sec / 60), 'min'] :
    sec < 86400 ? [Math.round(sec / 3600), 'h'] : [Math.round(sec / 86400), 'd'];
  return (t('ago') ? t('ago') + ' ' : '') + u[0] + ' ' + t(u[1]);
}

const use = u => u.kind === 'sensor' ? t('ts_sensor') + ' · ' + u.label
  : u.kind === 'rule' ? 'Rule' + u.n + ' (' + t(u.how === 'trigger' ? 'ts_trigger' : 'ts_cmd') + ')'
  : 'Matter · ' + u.ep + (u.role ? ' (' + u.role + ')' : '') + (u.enabled ? '' : ' · ' + t('ts_matterOff'));

// the device read again when the sheet opens; `read()` resolves to the object, or throws
function useRead(read, key) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!S.get().rules) loadRules();
    read().then(setData).catch(e => setErr(e.message));
  }, [key]);
  return [data, err];
}

// The layout both sheets share. `id`: [[label key, value]]; `link`: [[label, value]]; `cols`: the
// columns naming a row ([{ h, cell(r) }]); `rows`: from sheet_model.js; `refs`: ruleRefs().
function Sheet({ title, status, err, id, link, cols, rows, rowsTitle, refs, notes, onClose }) {
  const lang = L.get().lang;
  const src = r => r.src === 'event' ? t('ts_srcEvent') + ' ' + new Date(r.at).toLocaleTimeString(lang)
    : r.src === 'gateway' ? t('ts_srcGateway') : '—';
  const labels = { on: t('on'), off: t('off') };
  return html`<${Modal} title=${t('ts_title') + ' · ' + title} onClose=${onClose}>
    ${status ? html`<p class="q">${status}</p>` : null}
    ${err ? html`<div class="msg bad" role="alert">${err}</div>` : null}
    <dl class="sheet-id">${id.map(([k, v]) => html`<dt>${t('ts_' + k)}</dt><dd>${v}</dd>`)}</dl>
    ${link.length ? html`<h4>${t('ts_link')}</h4><dl class="sheet-id">${link.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>` : null}
    <h4>${rowsTitle + ' (' + rows.length + ')'}</h4>
    ${rows.length ? html`<div class="sheet-wrap"><table class="sheet">
      <thead><tr>${cols.map(c => html`<th>${c.h}</th>`)}<th>${t('ts_value')}</th><th>${t('ts_use')}</th><th>${t('ts_src')}</th></tr></thead>
      <tbody>${rows.map(r => html`<tr>
        ${cols.map(c => html`<td data-l=${c.h}>${c.cell(r)}</td>`)}
        <td data-l=${t('ts_value')}>${r.has ? showValue(r, labels) : '—'}</td>
        <td data-l=${t('ts_use')}>${r.uses.length ? r.uses.map(u => html`<div>${use(u)}</div>`) : '—'}</td>
        <td class="q" data-l=${t('ts_src')}>${src(r)}</td></tr>`)}</tbody>
    </table></div>` : html`<p class="q">${t('ts_noRow')}</p>`}
    <h4>${t('ts_rules')}</h4>
    ${!S.get().rules ? html`<p class="q">${t('loading')}</p>` : refs.sets.length || refs.berry.length ? html`<ul class="sheet-rules">
      ${refs.sets.map(r => html`<li>${'Rule' + r.n + ' · ' + r.refs + ' ' + t(r.refs > 1 ? 'ts_refs' : 'ts_ref') + ' · ' + t(r.on ? 'ts_ruleOn' : 'ts_ruleOff')}</li>`)}
      ${refs.berry.map(b => html`<li>Berry · <code>${b}</code></li>`)}</ul>` : html`<p class="q">${t('ts_noRule')}</p>`}
    ${notes.map(n => html`<p class="q">${n}</p>`)}
  </${Modal}>`;
}

export function TuyaSheet({ name, onClose }) {
  const s = S.get();
  const node = s.tuya && s.tuya.nodes[name];
  const conf = (s.tuya && s.tuya.conf) || {};
  const [read, err] = useRead(() => cmd('TuyaConfig ' + name).then(r => {
    const c = r && r.TuyaConfig;
    if (c && c.name) return c;
    throw new Error((c && c.Error) || (r && r.Command) || JSON.stringify(r));
  }), name);
  const entry = read || conf[name] || null;
  const rows = sheetRows(entry, node, s.rules, name);
  const notes = [];
  if (entry && !Object.keys(entry.codes || {}).length && !(entry.children || []).length) notes.push(t('ts_noCodes'));
  if (rows.some(r => !r.has)) notes.push(t('ts_kept'));
  notes.push(t('ts_fromTuya'));
  return html`<${Sheet} title=${name} onClose=${onClose} err=${read || conf[name] ? '' : err}
    status=${node ? t(node.connected ? 'connected' : 'disconnected') : ''}
    id=${identity(name, entry, node, conf)} link=${[]} rows=${rows} rowsTitle=${t('ts_dps')}
    cols=${[{ h: 'DP', cell: r => r.dp }, { h: t('ts_code'), cell: r => html`<code>${r.code || '—'}</code>` }]}
    refs=${ruleRefs('tuya', s.rules, [name, entry && entry.id])} notes=${notes}/>`;
}

export function ZigbeeSheet({ addr, onClose }) {
  const s = S.get();
  const d = (s.devices && s.devices[addr]) || { addr, attrs: {} };
  const [st, err] = useRead(() => cmd('ZbStatus3 ' + addr).then(r => {
    const l = r && r.ZbStatus3;
    if (Array.isArray(l) && l[0]) return l[0];
    throw new Error(typeof (r && r.ZbStatus3) === 'string' ? r.ZbStatus3 : JSON.stringify(r));
  }), addr);
  const k = zbLink(d, st, Date.now());
  const link = [['LQI', k.lqi != null ? String(k.lqi) : '?'], [t('ts_lastSeen'), ago(k.seen)]];
  if (k.reachable === false) link.push([t('ts_reach'), t('unreachable')]);
  if (k.battery != null) link.push([t('battery'), k.battery + ' %' + (k.batterySeen ? ' (' + new Date(k.batterySeen * 1000).toLocaleString(L.get().lang) + ')' : '')]);
  const id = zbIdentity(d, st).map(([key, v]) => [key, key === 'kind' ? t(v) : v === 'off' ? t('ts_disabled') : v]);
  const name = d.name && d.name !== d.addr ? d.name : '';
  const rows = zbRows(d, st, s.rules, s.zbNames);
  const notes = [];
  if (rows.some(r => !r.has)) notes.push(t('ts_zbKept'));
  notes.push(t('ts_fromZb'));
  return html`<${Sheet} title=${name || addr} onClose=${onClose} err=${err} status=${[d.model, d.manufacturer].filter(Boolean).join(' · ')}
    id=${id} link=${link} rows=${rows} rowsTitle=${t('ts_attrs')} cols=${[{ h: t('ts_attr'), cell: r => html`<code>${r.key}</code>` }]}
    refs=${ruleRefs('zigbee', s.rules, [addr, name])} notes=${notes}/>`;
}
