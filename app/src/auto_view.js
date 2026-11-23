// SPDX-License-Identifier: GPL-3.0-only
// The automations section of the Rules screen (Berry engine): the list, each in plain language with
// its switch, an editor in a dialog (When / If / Then, delays), the generated Berry read only
// (specification F3.6). Every change is saved at once (auto.js): the gateway keeps the previous
// version, checks that the Berry compiles and starts the new one. Registered with rules.js by main.js.
import { useState, useEffect } from 'preact/hooks';
import { html } from './html.js';
import { t } from './i18n.js';
import { S } from './state.js';
import { Modal } from './rules_modal.js';
import { Choice, actionGroups, verbs, conn, TRIGGERS } from './rules_editor.js';
import { describeCommand } from './rules_devices.js';
import { loadProducts } from './catalogue.js';
import { loadAutos, saveAutos, restoreAutos } from './auto.js';
import { generate, autoErrors, newId, OPS } from './auto_gen.js';
import { autoGroups, fromKey, keyOf, cmpOf, describe, duration, blankAuto } from './auto_model.js';

const labels = () => ({ gateway: t('rule_gwEvents'), ...conn() });
const say = (x, s) => describe(x, s, conn());
const sayCmd = (c, s) => describeCommand(c, s.devices, verbs(), s.tuya) || c;

// One trigger or state: what (a picker), then how its value is compared
function Pick({ label, item, set, remove, groups, s, connOk }) {
  const key = keyOf(item);
  const cmp = cmpOf(item);
  const put = (k, op, value) => set(fromKey(k, op, value, s.devices));
  const plain = item && item.src === 'tuyaconn';
  return html`<div class="trig"><div class="row tight">
      <${Choice} label=${label} value=${key} groups=${groups} placeholder=${t('rule_pickEvent')}
        friendly=${key ? say(fromKey(key, '', '', s.devices), s) : ''} onChange=${v => put(v, cmp.op, cmp.value)}/>
      ${remove ? html`<button class="b" aria-label=${t('rule_removeTrigger') + ' ' + label} onClick=${remove}>×</button>` : null}
    </div>
    ${plain || !key ? null : html`<div class="row tight">
      <select aria-label=${t('rule_operator') + ' ' + label} value=${cmp.op} onChange=${e => put(key, e.target.value, e.target.value ? cmp.value : '')}>
        <option value="">${t(connOk ? 'rule_anyValue' : 'au_pickOp')}</option>
        ${OPS.map(o => html`<option value=${o}>${o}</option>`)}
      </select>
      ${cmp.op ? html`<input class="grow" value=${cmp.value} aria-label=${t('rule_value') + ' ' + label} onInput=${e => put(key, cmp.op, e.target.value)}/>` : null}
    </div>`}</div>`;
}

// One step: a command (a picker of commands, or free text) or a delay
function Step({ n, st, set, remove, acts, s }) {
  const wait = st.wait != null;
  return html`<div class="row tight cmdrow">
    <select aria-label=${t('au_stepKind') + ' ' + n} value=${wait ? 'wait' : 'cmd'} onChange=${e => set(e.target.value === 'wait' ? { wait: 60, restart: true } : { cmd: '' })}>
      <option value="cmd">${t('au_cmd')}</option><option value="wait">${t('au_wait')}</option>
    </select>
    ${wait ? html`<input type="number" min="0" step="1" value=${st.wait} aria-label=${t('au_seconds') + ' ' + n} size="6" onInput=${e => set({ ...st, wait: e.target.value === '' ? '' : +e.target.value })}/>
        <span class="q">${t('au_secondsShort') + ' (' + duration(st.wait) + ')'}</span>
        <label><input type="checkbox" checked=${!!st.restart} onChange=${e => set({ ...st, restart: e.target.checked })}/> ${t('au_restart')}</label>`
      : html`<${Choice} label=${t('rule_then') + ' ' + n} value=${st.cmd || ''} groups=${acts} placeholder=${t('rule_pickAction')}
        friendly=${st.cmd ? sayCmd(st.cmd, s) : ''} onChange=${v => set({ cmd: v })}/>`}
    ${remove ? html`<button class="b" aria-label=${t('rule_removeCmd') + ' ' + n} onClick=${remove}>×</button>` : null}
  </div>`;
}

function AutoForm({ a, s, onSave, onClose, busy, err }) {
  const [x, setX] = useState(a);
  const put = p => setX({ ...x, ...p });
  const trig = autoGroups(s, labels(), TRIGGERS, true);
  const states = autoGroups(s, labels(), TRIGGERS, false);
  const acts = actionGroups(s);
  const when = x.when.length ? x.when : [{ src: 'rule', pat: '' }];
  const cond = x.cond;
  const errs = autoErrors(x);
  const code = generate([{ ...x, on: true }]);
  return html`<${Modal} title=${t('au_edit')} onClose=${onClose} foot=${html`
      <button class="b primary" disabled=${busy || errs.length > 0} onClick=${() => onSave(x)}>${t('rule_save')}</button>`}>
    <div class="form">
      <label>${t('au_name')}<input class="grow" value=${x.name} aria-label=${t('au_name')} onInput=${e => put({ name: e.target.value })}/></label>
      <fieldset class="cmds"><legend>${t('rule_when')}</legend>
        ${when.map((tr, i) => html`<${Pick} key=${i} label=${i ? t('rule_or').replace(/^./, c => c.toUpperCase()) + ' ' + (i + 1) : t('rule_when')} item=${tr} s=${s} groups=${trig} connOk=${true}
          set=${v => put({ when: when.map((y, k) => k === i ? v : y) })} remove=${when.length > 1 ? () => put({ when: when.filter((_, k) => k !== i) }) : null}/>`)}
        <button class="b" onClick=${() => put({ when: [...when, { src: 'rule', pat: '' }] })}>${t('rule_addTrigger')}</button>
      </fieldset>
      <fieldset class="cmds"><legend><label><input type="checkbox" checked=${!!cond} onChange=${e => put({ cond: e.target.checked ? { mode: 'all', items: [{ src: 'rule', pat: '' }] } : null })}/> ${t('rule_if')}</label></legend>
        ${cond ? html`<label>${t('au_mode')} <select aria-label=${t('au_mode')} value=${cond.mode} onChange=${e => put({ cond: { ...cond, mode: e.target.value } })}>
            <option value="all">${t('au_all')}</option><option value="any">${t('au_any')}</option></select></label>
          ${cond.items.map((it, i) => html`<${Pick} key=${i} label=${t('au_state') + ' ' + (i + 1)} item=${it} s=${s} groups=${states} connOk=${false}
            set=${v => put({ cond: { ...cond, items: cond.items.map((y, k) => k === i ? v : y) } })}
            remove=${cond.items.length > 1 ? () => put({ cond: { ...cond, items: cond.items.filter((_, k) => k !== i) } }) : null}/>`)}
          <button class="b" onClick=${() => put({ cond: { ...cond, items: [...cond.items, { src: 'rule', pat: '' }] } })}>${t('au_addState')}</button>`
        : html`<span class="q">${t('rule_noCond')}</span>`}
      </fieldset>
      <fieldset class="cmds"><legend>${t('rule_then')}</legend>
        ${x.then.map((st, i) => html`<${Step} key=${i} n=${i + 1} st=${st} s=${s} acts=${acts}
          set=${v => put({ then: x.then.map((y, k) => k === i ? v : y) })} remove=${x.then.length > 1 ? () => put({ then: x.then.filter((_, k) => k !== i) }) : null}/>`)}
        <div class="row tight"><button class="b" onClick=${() => put({ then: [...x.then, { cmd: '' }] })}>${t('rule_addCmd')}</button>
          <button class="b" onClick=${() => put({ then: [...x.then, { wait: 60, restart: true }] })}>${t('au_addWait')}</button></div>
      </fieldset>
      ${errs.map(e => html`<p class="q warn" role="status">⚠ ${t(e)}</p>`)}
      ${err ? html`<div class="msg bad" role="alert">${err}</div>` : null}
      <details><summary>${t('au_berry')}</summary><pre class="code">${code}</pre></details>
    </div>
  </${Modal}>`;
}

// one automation, in plain language
function AutoTile({ a, s, onEdit, onToggle, onCopy, onDelete, busy }) {
  const Line = ({ k, cls, items, joint }) => html`<div class=${'line ' + cls}><b class="kw">${k}</b>
    <span>${items.length ? items.map((x, i) => html`${i && joint ? html`<span class="or">${joint}</span>` : null}<span class="chip" title=${x}>${x}</span>`) : '…'}</span></div>`;
  const steps = a.then.map(st => (st.wait != null ? t('au_waitText').replace('{d}', duration(st.wait)) + (st.restart ? ' ' + t('au_restarted') : '') : sayCmd(st.cmd, s)));
  const errs = autoErrors(a);
  return html`<div class=${'tile' + (a.on === false ? ' off' : '')}>
    <div class="row tight"><label><input type="checkbox" checked=${a.on !== false} disabled=${busy} aria-label=${t('au_enabled') + ' ' + (a.name || a.id)}
      onChange=${e => onToggle(e.target.checked)}/> <b>${a.name || t('au_unnamed')}</b></label></div>
    <${Line} k=${t('rule_when')} cls="when" items=${a.when.map(x => say(x, s))} joint=${t('rule_or')}/>
    ${a.cond ? html`<${Line} k=${t('rule_if')} cls="if" items=${a.cond.items.map(x => say(x, s))} joint=${t(a.cond.mode === 'any' ? 'rule_or' : 'au_and')}/>` : null}
    <${Line} k=${t('rule_then')} cls="then" items=${steps}/>
    ${errs.length ? html`<p class="q warn">⚠ ${errs.map(e => t(e)).join(' ')}</p>` : null}
    <div class="row tight">
      <button class="b" disabled=${busy} onClick=${onEdit}>${t('rule_editBlock')}</button>
      <button class="b" disabled=${busy} onClick=${onCopy}>${t('au_copy')}</button>
      <button class="b" disabled=${busy} onClick=${onDelete}>${t('rule_deleteBlock')}</button>
    </div>
  </div>`;
}

export function AutoSection() {
  const s = S.get();
  const st = s.autos;
  const [edit, setEdit] = useState(null);                // the automation in the dialog
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (!st) loadAutos(); }, [s.gw]);
  useEffect(() => { if (!s.products) loadProducts(); }, [s.tuya && s.tuya.state, !s.products]);
  if (!st) return html`<p class="q">${t('loading')}</p>`;
  if (st.failed) return html`<p class="note">${t('au_noApi')}</p>`;
  const list = st.list;
  const save = async next => {
    setBusy(true);
    setErr('');
    try { await saveAutos(next); setEdit(null); } catch (e) { setErr(t('au_saveErr') + ' ' + e.message); }
    setBusy(false);
  };
  const replace = (a, b) => list.map(x => (x.id === a.id ? b : x));
  const on = list.filter(a => a.on !== false && !autoErrors(a).length).length;
  return html`<p class="q" role="status">${st.error ? t('au_notStarted') + ' ' + st.error : st.loaded ? t('au_running').replace('{n}', on) : t('au_none')}</p>
    ${err && !edit ? html`<div class="msg bad" role="alert">${err}</div>` : null}
    <div class="tiles">
      ${list.map(a => html`<${AutoTile} key=${a.id} a=${a} s=${s} busy=${busy} onEdit=${() => { setErr(''); setEdit(a); }}
        onToggle=${v => save(replace(a, { ...a, on: v }))}
        onCopy=${() => save([...list, { ...a, id: newId(list), name: (a.name || a.id) + ' (2)' }])}
        onDelete=${() => { if (confirm(t('au_delete').replace('{n}', a.name || a.id))) save(list.filter(x => x.id !== a.id)); }}/>`)}
      <button class="tile add" disabled=${busy} onClick=${() => { setErr(''); setEdit(blankAuto(newId(list))); }}>＋ ${t('au_new')}</button>
    </div>
    <div class="row tight">
      ${st.bak ? html`<button class="b" disabled=${busy} onClick=${async () => { if (!confirm(t('au_restoreAsk'))) return; setBusy(true); try { await restoreAutos(); } catch (e) { setErr(e.message); } setBusy(false); }}>${t('au_restore')}</button>` : null}
    </div>
    <p class="q">${t('au_help')}</p>
    ${edit ? html`<${AutoForm} a=${edit} s=${s} busy=${busy} err=${err} onClose=${() => setEdit(null)}
      onSave=${x => save(list.some(y => y.id === x.id) ? replace(x, x) : [...list, x])}/>` : null}`;
}
