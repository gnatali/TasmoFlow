// SPDX-License-Identifier: GPL-3.0-only
// Sentence editor of a rule set: "When ... If ... Then ... Else ...". Full interface only (main.js
// registers it with rules.js; the light interface does not carry it). It owns the list of blocks
// while it is open and hands the written text to the card after every change.
import { useState, useRef, useEffect } from 'preact/hooks';
import { html } from './html.js';
import { t } from './i18n.js';
import { S } from './state.js';
import { zbTriggers, zbActions, tuyaActions, describeSubject, describeCommand } from './rules_devices.js';
import { parseRuleSet, serializeRuleSet, serializeBlock, newBlock, edited, parseCommands, writeCommands, OPERATORS } from './rules_model.js';

// suggestions only: every field stays free text
const TRIGGERS = ['System#Boot', 'Time#Minute', 'Clock#Timer', 'Rules#Timer', 'Button1#State', 'Switch1#State',
  'Power1#State', 'Wifi#Connected', 'Wifi#Disconnected', 'Mqtt#Connected', 'Tele-ENERGY#Power'];
const ACTIONS = ['Power1 on', 'Power1 off', 'Power1 toggle', 'Power2 toggle', 'Var1 ', 'Mem1 ', 'RuleTimer1 ', 'Delay 10', 'Restart 1'];

const items = l => l.map(x => ({ label: x.trim(), value: x }));
const verbs = () => ({ On: t('rule_vOn'), Off: t('rule_vOff'), Toggle: t('rule_vToggle') });

// What each list offers: the common ones, then the gateway's own devices
function triggerGroups(s) {
  const z = zbTriggers(s.devices, s.zbNames);
  return { skipped: z.skipped, groups: [{ group: t('rule_gwEvents'), items: items(TRIGGERS) },
    ...z.groups.map(g => ({ ...g, group: 'Zigbee · ' + g.group }))] };
}
function actionGroups(s) {
  return [{ group: t('rule_commands'), items: items(ACTIONS) },
    ...zbActions(s.devices, verbs()).map(g => ({ ...g, group: 'Zigbee · ' + g.group })),
    ...tuyaActions(s.tuya, verbs())];
}

// A <datalist> only offers what matches the text already typed: once a field holds a value, the
// other suggestions are gone. A list that always shows everything and fills the field instead.
function Pick({ groups, onPick }) {
  return html`<select class="pick" aria-label=${t('rule_suggest')} value="" onChange=${e => {
    const v = e.target.value;
    e.target.value = '';
    if (v) onPick(v);
  }}>
    <option value="">▾</option>
    ${groups.map(g => html`<optgroup label=${g.group}>${g.items.map(i => html`<option value=${i.value}>${i.label}</option>`)}</optgroup>`)}
  </select>`;
}

// the commands of Then / Else, one field each
function Commands({ label, list, set, groups, bare }) {
  const rows = list.length ? list : [''];
  const put = (i, v) => set(rows.map((x, k) => k === i ? v : x));
  const Box = bare ? 'div' : 'fieldset';
  return html`<${Box} class=${bare ? '' : 'cmds'}>${bare ? null : html`<legend>${label}</legend>`}
    ${rows.map((c, i) => html`<div class="row tight">
      <input class="grow" value=${c} aria-label=${label + ' ' + (i + 1)} onInput=${e => put(i, e.target.value)}/>
      <${Pick} groups=${groups} onPick=${v => put(i, v)}/>
      ${rows.length > 1 ? html`<button class="b" aria-label=${t('rule_removeCmd')} onClick=${() => set(rows.filter((_, k) => k !== i))}>×</button>` : null}
    </div>`)}
    <button class="b" onClick=${() => set([...rows, ''])}>${t('rule_addCmd')}</button>
  </${Box}>`;
}

// One tile per block: what it waits for, what it checks, what it does
function Tile({ b, s, onEdit, onDelete }) {
  if (b.kind === 'raw') {
    return html`<div class="tile raw"><code>${b.text}</code><p class="q">${t('rule_rawBlock')}</p>
      <div class="row tight"><button class="b" onClick=${onDelete}>${t('rule_deleteBlock')}</button></div></div>`;
  }
  const named = describeSubject(b.subject, s.devices, s.zbNames);
  const when = (named || b.subject || '…') + (b.op ? ' ' + b.op + ' ' + b.value : '');
  const list = l => l.filter(Boolean).map(c => describeCommand(c, s.devices, verbs()) || c);
  const Line = ({ k, cls, items }) => html`<div class=${'line ' + cls}><b class="kw">${k}</b>
    <span>${items.length ? items.map(x => html`<span class="chip" title=${x}>${x}</span>`) : '…'}</span></div>`;
  return html`<div class="tile">
    <${Line} k=${t('rule_when')} cls="when" items=${[when]}/>
    ${b.cond != null ? html`<${Line} k=${t('rule_if')} cls="if" items=${[b.cond || '…']}/>` : null}
    <${Line} k=${t('rule_then')} cls="then" items=${list(b.then)}/>
    ${b.else ? html`<${Line} k=${t('rule_else')} cls="else" items=${list(b.else)}/>` : null}
    <div class="row tight">
      <button class="b" onClick=${onEdit}>${t('rule_editBlock')}</button>
      <button class="b" onClick=${onDelete}>${t('rule_deleteBlock')}</button>
    </div>
  </div>`;
}

// A dialog over the page (native <dialog>: Escape and the backdrop close it)
function Modal({ title, onClose, children }) {
  const ref = useRef();
  useEffect(() => { if (ref.current && !ref.current.open) ref.current.showModal(); }, []);
  const close = () => ref.current && ref.current.close();
  return html`<dialog ref=${ref} class="modal" aria-label=${title} onClose=${onClose}
      onClick=${e => { if (e.target === ref.current) close(); }}>
    <div class="mhead"><h3>${title}</h3><button class="b" aria-label=${t('rule_closeBlock')} onClick=${close}>×</button></div>
    ${children}
    <div class="row tight mfoot"><button class="b primary" onClick=${close}>${t('rule_finish')}</button></div>
  </dialog>`;
}

function BlockForm({ b, change, s }) {
  const hasCond = b.cond != null;
  const trig = triggerGroups(s);
  const acts = actionGroups(s);
  return html`<div class="form">
    <fieldset class="cmds"><legend>${t('rule_when')}</legend>
      <div class="row tight">
        <input class="grow" value=${b.subject} aria-label=${t('rule_when')} placeholder="Button1#State" onInput=${e => change({ subject: e.target.value })}/>
        <${Pick} groups=${trig.groups} onPick=${v => change({ subject: v })}/>
      </div>
      ${trig.skipped ? html`<div class="q">${t('rule_zbSkipped')}</div>` : null}
      <div class="row tight">
        <select aria-label=${t('rule_operator')} value=${b.op} onChange=${e => change({ op: e.target.value, value: e.target.value ? b.value : '' })}>
          <option value="">${t('rule_anyValue')}</option>
          ${OPERATORS.map(o => html`<option value=${o}>${o}</option>`)}
          ${b.op && !OPERATORS.includes(b.op) ? html`<option value=${b.op}>${b.op}</option>` : null}
        </select>
        ${b.op ? html`<input class="grow" value=${b.value} aria-label=${t('rule_value')} placeholder="3" onInput=${e => change({ value: e.target.value })}/>` : null}
      </div>
    </fieldset>
    <fieldset class="cmds"><legend><label><input type="checkbox" checked=${hasCond} onChange=${e => change({ cond: e.target.checked ? '' : null, else: null })}/> ${t('rule_if')}</label></legend>
      ${hasCond ? html`<input class="grow" value=${b.cond} aria-label=${t('rule_if')} placeholder="Var1==1" onInput=${e => change({ cond: e.target.value })}/>` : html`<span class="q">${t('rule_noCond')}</span>`}
    </fieldset>
    <${Commands} label=${t('rule_then')} list=${b.then} set=${v => change({ then: v })} groups=${acts}/>
    ${hasCond ? html`<fieldset class="cmds"><legend><label><input type="checkbox" checked=${!!b.else} onChange=${e => change({ else: e.target.checked ? [''] : null })}/> ${t('rule_else')}</label></legend>
      ${b.else ? html`<${Commands} label=${t('rule_else')} list=${b.else} set=${v => change({ else: v })} groups=${acts} bare=${true}/>` : html`<span class="q">${t('rule_noElse')}</span>`}</fieldset>` : null}
  </div>`;
}

// text: the rule set as written now; setText(newText) after every change
export function SentenceEditor({ text, setText }) {
  const s = S.use();                                 // devices, Tuya, SetOption83
  const [blocks, setBlocks] = useState(() => parseRuleSet(text));
  const [open, setOpen] = useState(-1);
  if (!blocks) return html`<p class="q">${t('rule_noSentence')}</p>`;
  const commit = list => { setBlocks(list); setText(serializeRuleSet(list)); };
  const change = (i, patch) => commit(blocks.map((b, k) => k === i ? edited(b, patch) : b));
  const cur = open >= 0 ? blocks[open] : null;
  return html`<div class="tiles">
    ${blocks.map((b, i) => html`<${Tile} key=${i} b=${b} s=${s} onEdit=${() => setOpen(i)} onDelete=${() => { commit(blocks.filter((_, k) => k !== i)); setOpen(-1); }}/>`)}
    <button class="tile add" onClick=${() => { commit([...blocks, newBlock()]); setOpen(blocks.length); }}>＋ ${t('rule_addBlock')}</button>
    ${cur && cur.kind === 'sentence' ? html`<${Modal} title=${t('rule_editTitle')} onClose=${() => setOpen(-1)}>
      <${BlockForm} b=${cur} s=${s} change=${p => change(open, p)}/></${Modal}>` : null}
  </div>`;
}
