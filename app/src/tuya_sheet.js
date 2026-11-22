// SPDX-License-Identifier: GPL-3.0-only
// Details sheet of a local Tuya device, opened from its card: identity, data points (code, value,
// what uses them, where the value comes from), Matter bindings and sensor readings. Read only.
// The entry is read again when the sheet opens (`TuyaConfig <device>`: one entry, read entry by
// entry by the firmware, no lasting memory cost measured on 22 November 2026); the local key is
// masked by the firmware and never shown. The logic is in tuya_sheet_model.js.
import { useState, useEffect } from 'preact/hooks';
import { html } from './html.js';
import { t, L } from './i18n.js';
import { S, cmd } from './state.js';
import { Modal } from './rules_modal.js';
import { sheetRows, showValue, identity } from './tuya_sheet_model.js';

const use = u => u.kind === 'sensor' ? t('ts_sensor') + ' · ' + u.label
  : 'Matter · ' + u.ep + (u.role ? ' (' + u.role + ')' : '') + (u.enabled ? '' : ' · ' + t('ts_matterOff'));

export function TuyaSheet({ name, onClose }) {
  const s = S.get();
  const node = s.tuya && s.tuya.nodes[name];
  const conf = (s.tuya && s.tuya.conf) || {};
  const [entry, setEntry] = useState(conf[name] || null);
  const [err, setErr] = useState('');
  useEffect(() => {
    cmd('TuyaConfig ' + name).then(r => {
      const c = r && r.TuyaConfig;
      if (c && c.name) setEntry(c);
      else if (!entry) setErr((c && c.Error) || (r && r.Command) || JSON.stringify(r));
    }).catch(e => { if (!entry) setErr(e.message); });
  }, [name]);
  const rows = sheetRows(entry, node);
  const lang = L.get().lang;
  const src = r => r.src === 'event' ? t('ts_srcEvent') + ' ' + new Date(r.at).toLocaleTimeString(lang)
    : r.src === 'gateway' ? t('ts_srcGateway') : '—';
  const labels = { on: t('on'), off: t('off') };
  const known = rows.filter(r => r.has).length;
  return html`<${Modal} title=${t('ts_title') + ' · ' + name} onClose=${onClose}>
    <p class="q">${node ? (node.connected ? t('connected') : t('disconnected')) : ''}</p>
    ${err ? html`<div class="msg bad" role="alert">${err}</div>` : null}
    <dl class="sheet-id">${identity(name, entry, node, conf).map(([k, v]) => html`<dt>${t('ts_' + k)}</dt><dd>${v}</dd>`)}</dl>
    <h4>${t('ts_dps') + ' (' + rows.length + ')'}</h4>
    ${rows.length ? html`<div class="sheet-wrap"><table class="sheet">
      <thead><tr><th>DP</th><th>${t('ts_code')}</th><th>${t('ts_value')}</th><th>${t('ts_use')}</th><th>${t('ts_src')}</th></tr></thead>
      <tbody>${rows.map(r => html`<tr>
        <td data-l="DP">${r.dp}</td><td data-l=${t('ts_code')}><code>${r.code || '—'}</code></td>
        <td data-l=${t('ts_value')}>${r.has ? showValue(r, labels) : '—'}</td>
        <td data-l=${t('ts_use')}>${r.uses.length ? r.uses.map(u => html`<div>${use(u)}</div>`) : '—'}</td><td class="q" data-l=${t('ts_src')}>${src(r)}</td></tr>`)}</tbody>
    </table></div>` : html`<p class="q">${t('ts_noDp')}</p>`}
    ${entry && !Object.keys(entry.codes || {}).length && !(entry.children || []).length ? html`<p class="note">${t('ts_noCodes')}</p>` : null}
    ${rows.length && known < rows.length ? html`<p class="q">${t('ts_kept')}</p>` : null}
    <p class="q">${t('ts_from')}</p>
  </${Modal}>`;
}
