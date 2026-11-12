// SPDX-License-Identifier: GPL-3.0-only
// Guided mode of the sentence editor: a dialog in two steps, "1. When" (pick a device, then say what
// happens to it, or press its button and let the interface write the trigger from the message it
// receives) and "2. Then" (pick a device to control and what to do), with the sentence it makes.
// Full interface only. The block it builds goes through the same editor as any other (Edit).
import { useState, useEffect } from 'preact/hooks';
import { html } from './html.js';
import { t } from './i18n.js';
import { describeSubject, describeCommand } from './rules_devices.js';
import { guidedDevices, seenValues, triggerOptions, learn, guidedBlock } from './rules_guided_model.js';
import { Modal } from './rules_modal.js';

const fill = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k]);
const sameOpt = (a, b) => !!a && !!b && a.op === b.op && a.value === b.value;
// the ones a command still waits a value for (`TuyaSend Name,62,`)
const open = c => c.endsWith(',');

// "turns on", "every message", "Click = single"...
function optLabel(o, attr) {
  if (o.kind === 'on') return t('g_on');
  if (o.kind === 'off') return t('g_off');
  if (attr === 'Power') return t('g_change');
  return o.kind === 'any' ? fill(t('g_every'), { a: attr }) : attr + ' = ' + o.value;
}

// What to do: one row per command, a device then an action (and a value for a slider)
function Doing({ groups, rows, set }) {
  const put = (i, p) => set(rows.map((r, k) => k === i ? { ...r, ...p } : r));
  return html`<fieldset class="cmds"><legend>${t('g_then')}</legend>
    ${rows.map((r, i) => {
      const g = groups[r.g];
      const it = g && g.items[r.i];
      return html`<div class="row tight cmdrow">
        <select aria-label=${t('g_target') + ' ' + (i + 1)} value=${r.g} onChange=${e => put(i, { g: e.target.value, i: '', v: '' })}>
          <option value="">${t('g_pickTarget')}</option>
          ${groups.map((x, k) => html`<option value=${k}>${x.group}</option>`)}
        </select>
        ${g ? html`<select aria-label=${t('g_action') + ' ' + (i + 1)} value=${r.i} onChange=${e => put(i, { i: e.target.value, v: '' })}>
          <option value="">${t('g_pickAction')}</option>
          ${g.items.map((x, k) => html`<option value=${k}>${x.label}</option>`)}
        </select>` : null}
        ${it && open(it.value) ? html`<input value=${r.v} aria-label=${t('g_value') + ' ' + (i + 1)} size="6" onInput=${e => put(i, { v: e.target.value })}/>` : null}
        ${rows.length > 1 ? html`<button class="b" aria-label=${t('g_removeAction')} onClick=${() => set(rows.filter((_, k) => k !== i))}>×</button>` : null}
      </div>`;
    })}
    <button class="b" onClick=${() => set([...rows, { g: '', i: '', v: '' }])}>${t('g_addAction')}</button>
  </fieldset>`;
}

// s: state (devices, events, Tuya, SetOption83); groups: what can be controlled (rules_editor.js);
// verbs: { On, Off, Toggle } in the user's language. onCreate(block), onFree(): the free form.
export function Guided({ s, groups, verbs, onCreate, onFree, onClose }) {
  const { list, skipped } = guidedDevices(s.devices, s.zbNames);
  const [addr, setAddr] = useState('');
  const [attr, setAttr] = useState('');
  const [opt, setOpt] = useState(null);                 // { op, value } chosen
  const [listen, setListen] = useState(null);           // { base }: waiting for a message
  const [heard, setHeard] = useState('');
  const [rows, setRows] = useState([{ g: '', i: '', v: '' }]);
  const known = s.devices && s.devices[addr];

  // a message received while listening: it fills the device, the attribute and the value
  const hit = listen ? learn(s.events, listen.base, addr) : null;
  useEffect(() => {
    if (!hit) return;
    setListen(null);
    setAddr(hit.addr);
    setAttr(hit.attr);
    setOpt({ op: hit.op, value: hit.value });
    const d = (s.devices && s.devices[hit.addr]) || {};
    setHeard((d.name || hit.name || hit.addr) + ' · ' + hit.attr + (hit.op ? ' = ' + hit.value : ''));
  }, [hit && hit.seq]);

  const pickDevice = a => { setAddr(a); setHeard(''); setOpt(null); const d = list.find(x => x.addr === a); setAttr(d ? d.attrs[0] : ''); };
  const pickAttr = a => { setAttr(a); setHeard(''); setOpt(null); };
  // a device heard but not in the list (a name with a space...): it is still the one to use
  const shownList = addr && !list.some(d => d.addr === addr)
    ? [...list, { addr, label: (known && known.name) || addr, key: addr, attrs: attr ? [attr] : [] }] : list;
  const cur = shownList.find(d => d.addr === addr);
  const attrs = cur ? (!attr || cur.attrs.includes(attr) ? cur.attrs : [attr, ...cur.attrs]) : [];
  const values = cur && attr ? seenValues(s.events, known || { addr }, attr) : [];
  if (opt && opt.value && !values.includes(opt.value)) values.push(opt.value);
  const options = cur && attr ? triggerOptions(attr, values) : [];

  const cmds = rows.map(r => {
    const it = groups[r.g] && groups[r.g].items[r.i];
    return it ? (open(it.value) ? (r.v.trim() ? it.value + r.v.trim() : '') : it.value) : '';
  });
  const done = cur && attr && opt && cmds.every(Boolean);
  const block = done ? guidedBlock({ addr, attr, op: opt.op, value: opt.value }, cmds, s.devices, s.zbNames) : null;
  const sentence = block ? fill(t('g_summary'), {
    w: (describeSubject(block.subject, s.devices, s.zbNames) || block.subject) + (block.op ? ' ' + block.op + ' ' + block.value : ''),
    t: block.then.map(c => describeCommand(c, s.devices, verbs, s.tuya) || c).join(', ')
  }) : '';

  const foot = html`<button class="b" onClick=${onFree}>${t('g_toFree')}</button>
    <button class="b" onClick=${onClose}>${t('rule_cancel')}</button>
    <button class="b primary" disabled=${!block} onClick=${() => onCreate(block)}>${t('g_create')}</button>`;

  return html`<${Modal} title=${t('g_title')} onClose=${onClose} foot=${foot}>
    <div class="form">
      <fieldset class="cmds"><legend>${t('g_when')}</legend>
        ${!shownList.length ? html`<p class="q">${t('g_noDevices')}</p>` : null}
        <div class="row tight">
          <select class="grow" aria-label=${t('g_device')} value=${addr} onChange=${e => pickDevice(e.target.value)}>
            <option value="">${t('g_pickDevice')}</option>
            ${shownList.map(d => html`<option value=${d.addr}>${d.label}</option>`)}
          </select>
          ${listen ? html`<button class="b" onClick=${() => setListen(null)}>${t('g_stop')}</button>`
            : html`<button class="b" onClick=${() => { setHeard(''); setListen({ base: s.events.length ? s.events[0].seq : 0 }); }}>${t('g_learn')}</button>`}
        </div>
        ${listen ? html`<p class="q" role="status">${t('g_listening')}</p>` : null}
        ${heard ? html`<p class="q" role="status">${fill(t('g_heard'), { w: heard })}</p>` : null}
        ${skipped ? html`<p class="q">${t('rule_zbSkipped')}</p>` : null}
        ${attrs.length > 1 ? html`<div class="row tight"><label>${t('g_info')}
          <select value=${attr} onChange=${e => pickAttr(e.target.value)}>${attrs.map(a => html`<option value=${a}>${a}</option>`)}</select></label></div>` : null}
        ${options.length ? html`<div role="radiogroup" aria-label=${t('g_what')}><p class="q">${t('g_what')}</p>
          ${options.map(o => html`<label class="opt"><input type="radio" name="g-opt" checked=${sameOpt(opt, o)}
            onChange=${() => setOpt({ op: o.op, value: o.value })}/> ${optLabel(o, attr)}</label>`)}</div>` : null}
      </fieldset>
      ${opt && cur ? html`<${Doing} groups=${groups} rows=${rows} set=${setRows}/>${groups.length ? null : html`<p class="q">${t('g_noActions')}</p>`}` : null}
      ${sentence ? html`<p class="sentence" role="status"><b>${t('g_summaryTitle')}</b> ${sentence}</p><p class="q">${t('g_help')}</p>` : null}
    </div>
  </${Modal}>`;
}
