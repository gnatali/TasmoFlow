// SPDX-License-Identifier: GPL-3.0-only
// Renaming a Zigbee device (ZbName) or a local Tuya device (TuyaRename, firmware of 21 November
// 2026) from its card. A name is more than a label: rule triggers (ZbReceived#<name>#... with
// SetOption83 on, TuyaConnected#Name=<name>), commands (ZbSend {"device":"<name>"...},
// TuyaSend <name>,...) and Matter endpoints use it. renameRefs() rewrites what a rule set says of
// the old name; the dialog offers it, set by set, once the device is renamed (saveRule() keeps the
// previous copy). Berry rules and autoexec.be are read only here: they are only listed. The model
// (renameRefs, nameError) is in rename_model.js.
import { useState, useEffect } from 'preact/hooks';
import { html } from './html.js';
import { t } from './i18n.js';
import { S, cmd, loadDevices, loadTuya } from './state.js';
import { loadRules, saveRule } from './rules.js';
import { Modal } from './rules_modal.js';
import { usableKey } from './rules_devices.js';
import { renameRefs, nameError } from './rename_model.js';

// The Tuya configuration the interface keeps is indexed by name: the renamed device's entry, and
// its gateway's (whose children name it), are dropped so that loadTuya() reads them again.
function dropConf(old) {
  S.set(s => {
    if (!s.tuya || !s.tuya.conf) return {};
    const conf = {};
    for (const k in s.tuya.conf) {
      const e = s.tuya.conf[k];
      if (k !== old && !(e.children || []).some(c => c.name === old)) conf[k] = e;
    }
    return { tuya: { ...s.tuya, conf } };
  });
}

// kind 'zigbee' (addr, name: its friendly name or '') or 'tuya' (name)
export function RenameDialog({ kind, addr, name, onClose }) {
  const s = S.get();
  const [val, setVal] = useState(name);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [skip, setSkip] = useState({});                // rule sets the user does not want rewritten
  useEffect(() => { if (!S.get().rules) loadRules(); }, []);
  const to = val.trim();
  const err = nameError(kind, to, name, addr, s);
  const warns = [];
  let ref;
  if (kind === 'zigbee') {
    const z = s.zbNames;
    const lost = z && to && !usableKey(to);              // no trigger can carry this name
    if (lost) warns.push(t('rn_zbKey'));
    ref = { trigFrom: z && name ? name : addr, trigTo: lost ? null : (z && to ? to : addr), from: name, to: to || addr };
    if (name) warns.push(t('rn_zbMatter'));
  } else {
    ref = { from: name, to };
    warns.push(t('rn_tuyaMatter'));
  }
  const rules = s.rules;
  const hits = !rules || err ? [] : rules.rules.map(r => ({ r, ...renameRefs(r.text, kind, ref) })).filter(h => h.n);
  const old = name.toLowerCase();
  const berry = rules && name ? rules.berry.filter(b => b.rule.toLowerCase().includes(old)) : [];
  if (berry.length) warns.push(t('rn_berry') + ' ' + berry.map(b => b.rule).join(', '));

  const go = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (kind === 'zigbee') {
        // Tasmota answers {"0x1234":{"Name":"..."}}, or {"ZbName":"Unknown device"}
        const r = (await cmd('ZbName ' + addr + ',' + to)) || {};
        if (!Object.keys(r).some(k => k.toLowerCase() === addr.toLowerCase())) throw new Error(typeof r.ZbName === 'string' ? r.ZbName : JSON.stringify(r));
      } else {
        const r = (await cmd('TuyaRename ' + name + ',' + to)) || {};
        if (r.Command === 'Unknown') throw new Error(t('rn_tooOld'));
        const x = r.TuyaRename;
        if (!x || x.Error) throw new Error(x && x.Error ? x.Error : JSON.stringify(r));
        dropConf(name);
      }
      const failed = [];
      for (const h of hits) {
        if (skip[h.r.n]) continue;
        try { await saveRule(h.r.n, h.text); } catch (e) { failed.push('Rule' + h.r.n + ' (' + e.message + ')'); }
      }
      await (kind === 'zigbee' ? loadDevices() : loadTuya());
      if (hits.length) await loadRules();
      if (failed.length) { setMsg(t('rn_rulesFailed') + ' ' + failed.join(', ')); setBusy(false); return; }
      onClose();
    } catch (e) {
      setMsg(e.message);
      setBusy(false);
    }
  };
  const title = t('rn_title') + ' · ' + (name || addr);
  return html`<${Modal} title=${title} onClose=${onClose} foot=${html`
      <button class="b primary" disabled=${busy || !!err} onClick=${go}>${t('rn_do')}</button>`}>
    <label class="form">${t('rn_new')}
      <input value=${val} maxlength=${kind === 'zigbee' ? 32 : 64} aria-label=${t('rn_new')} onInput=${e => setVal(e.target.value)}
        onKeyDown=${e => { if (e.key === 'Enter' && !err && !busy) go(); }}/></label>
    ${kind === 'zigbee' && !to && name ? html`<p class="q">${t('rn_zbClear')}</p>` : null}
    ${err && err !== 'rn_same' ? html`<div class="msg bad" role="alert">${t(err)}</div>` : null}
    ${!rules ? html`<p class="q">${t('loading')}</p>` : hits.length ? html`<fieldset><legend>${t('rn_rules')}</legend>
      ${hits.map(h => html`<label><input type="checkbox" checked=${!skip[h.r.n]} onChange=${e => setSkip({ ...skip, [h.r.n]: !e.target.checked })}/>
        ${' Rule' + h.r.n + ' (' + h.n + ')'}</label>`)}</fieldset>` : err ? null : html`<p class="q">${t('rn_noRule')}</p>`}
    ${err ? null : warns.map(w => html`<p class="note">${w}</p>`)}
    ${msg ? html`<div class="msg bad" role="alert">${msg}</div>` : null}
  </${Modal}>`;
}
