// SPDX-License-Identifier: GPL-3.0-only
// Sentence editor of a rule set: "When ... If ... Then ... Else ...". Full interface only (main.js
// registers it with rules.js; the light interface does not carry it). It owns the list of blocks
// while it is open and hands the written text to the card after every change.
import { useState, useRef, useEffect } from 'preact/hooks';
import { html } from './html.js';
import { t } from './i18n.js';
import { S } from './state.js';
import { zbTriggers, zbActions, tuyaActions, tuyaTriggers, describeSubject, describeCommand, describeTrigger, describeConnection } from './rules_devices.js';
import { Modal } from './rules_modal.js';
import { Guided } from './rules_guided.js';
import { parseRuleSet, serializeRuleSet, newBlock, edited, triggersOf, OPERATORS } from './rules_model.js';

// suggestions only: every field stays free text
const TRIGGERS = ['System#Boot', 'Time#Minute', 'Clock#Timer', 'Rules#Timer', 'Button1#State', 'Switch1#State',
  'Power1#State', 'Wifi#Connected', 'Wifi#Disconnected', 'Mqtt#Connected', 'Tele-ENERGY#Power'];
const ACTIONS = ['Power1 on', 'Power1 off', 'Power1 toggle', 'Power2 toggle', 'Var1 ', 'Mem1 ', 'RuleTimer1 ', 'Delay 10', 'Restart 1'];

const items = l => l.map(x => ({ label: x.trim(), value: x }));
const verbs = () => ({ On: t('rule_vOn'), Off: t('rule_vOff'), Toggle: t('rule_vToggle') });

// What each list offers: the common ones, then the gateway's own devices
const conn = () => ({ connected: t('rule_connected'), disconnected: t('rule_disconnected') });
function triggerGroups(s) {
  const z = zbTriggers(s.devices, s.zbNames, conn());
  return { skipped: z.skipped, groups: [{ group: t('rule_gwEvents'), items: items(TRIGGERS) },
    ...z.groups.map(g => ({ ...g, group: 'Zigbee · ' + g.group })), ...tuyaTriggers(s.tuya, conn())] };
}
function actionGroups(s) {
  return [{ group: t('rule_commands'), items: items(ACTIONS) },
    ...zbActions(s.devices, verbs()).map(g => ({ ...g, group: 'Zigbee · ' + g.group })),
    ...tuyaActions(s.tuya, verbs())];
}

// inline style from { left: 12, width: 300, ... } in pixels (a string: it is what Preact applies for sure)
const css = o => Object.keys(o).map(k => k.replace(/[A-Z]/g, c => '-' + c.toLowerCase()) + ':' + Math.round(o[k]) + 'px').join(';');

// One field for "what": closed, it reads like the tile ("Lampe salon · Power"); open, it lists
// everything as a tree (a group per device) with the current item highlighted. "Custom" turns it
// into a text field, so any Tasmota trigger or command can still be written. A native <select>
// cannot do this: it shows the same text open and closed, and a <datalist> only offers what
// matches the text already typed.
function Choice({ label, value, groups, friendly, onChange, placeholder, isSel }) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [pos, setPos] = useState(null);               // where the list floats, in the window
  const box = useRef();
  useEffect(() => {
    if (!open) return;
    // The list is `position: fixed`, placed from the button: inside the dialog, which scrolls,
    // an absolute list would be cut off by it. It opens below the button, or above when there
    // is more room there, and follows the button while the dialog scrolls.
    const place = () => {
      const btn = box.current && box.current.querySelector('.choice-btn, input');
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const up = below < 200 && above > below;
      const room = Math.max(120, up ? above : below);
      setPos({ left: r.left, width: r.width, maxHeight: Math.min(room, 352), ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
    };
    place();
    const away = e => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', away);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const sel = box.current && box.current.querySelector('.sel');
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
    return () => {
      document.removeEventListener('click', away);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  const sel = isSel || (i => i.value === value);        // the item that stands for the current value
  const known = groups.some(g => g.items.some(sel));
  const pick = i => {
    onChange(i.value, i);
    setOpen(false);
    setEdit(i.value.endsWith(','));                      // `TuyaSend Name,62,` still needs its value
  };
  // Escape closes the list, not the dialog around it
  const key = e => { if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); } };
  return html`<div class="choice" ref=${box} onKeyDown=${key}>
    ${edit
      ? html`<div class="row tight"><input class="grow" value=${value} aria-label=${label} onInput=${e => onChange(e.target.value)}/>
          <button class="b" aria-label=${t('rule_list')} title=${t('rule_list')} onClick=${() => { setEdit(false); setOpen(true); }}>▾</button></div>`
      : html`<button class="b choice-btn" aria-haspopup="listbox" aria-expanded=${open} aria-label=${label + ' : ' + (friendly || placeholder)}
          onClick=${() => setOpen(!open)}><span>${friendly || html`<i>${placeholder}</i>`}</span><span aria-hidden="true">▾</span></button>`}
    ${open && pos ? html`<div class="pop" role="listbox" aria-label=${label} style=${css(pos)}>
      ${value && !known ? html`<button role="option" aria-selected="true" class="pitem sel" onClick=${() => setOpen(false)}>${friendly || value}</button>` : null}
      ${groups.map(g => html`<div class="pgroup">${g.group}</div>
        ${g.items.map(i => html`<button role="option" aria-selected=${sel(i)} class=${'pitem' + (sel(i) ? ' sel' : '')} onClick=${() => pick(i)}>${i.label}</button>`)}`)}
      <button role="option" class="pitem custom" onClick=${() => { setEdit(true); setOpen(false); }}><span aria-hidden="true">✎ </span>${t('rule_custom')}</button>
    </div>` : null}
  </div>`;
}

// the commands of Then / Else, one field each
function Commands({ label, list, set, groups, bare, s }) {
  const rows = list.length ? list : [''];
  const put = (i, v) => set(rows.map((x, k) => k === i ? v : x));
  const Box = bare ? 'div' : 'fieldset';
  return html`<${Box} class=${bare ? '' : 'cmds'}>${bare ? null : html`<legend>${label}</legend>`}
    ${rows.map((c, i) => html`<div class="row tight cmdrow">
      <${Choice} label=${label + ' ' + (i + 1)} value=${c} groups=${groups} placeholder=${t('rule_pickAction')}
        friendly=${c ? (describeCommand(c, s.devices, verbs(), s.tuya) || c) : ''} onChange=${v => put(i, v)}/>
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
  const when = triggersOf(b).map(tr => describeTrigger(tr, s.devices, s.zbNames, conn()));
  const list = l => l.filter(Boolean).map(c => describeCommand(c, s.devices, verbs(), s.tuya) || c);
  // `or`: between the triggers of a sentence, any of them fires it
  const Line = ({ k, cls, items, or }) => html`<div class=${'line ' + cls}><b class="kw">${k}</b>
    <span>${items.length ? items.map((x, i) => html`${i && or ? html`<span class="or">${t('rule_or')}</span>` : null}<span class="chip" title=${x}>${x}</span>`) : '…'}</span></div>`;
  return html`<div class="tile">
    <${Line} k=${t('rule_when')} cls="when" items=${when} or=${true}/>
    ${b.cond != null ? html`<${Line} k=${t('rule_if')} cls="if" items=${[b.cond || '…']}/>` : null}
    <${Line} k=${t('rule_then')} cls="then" items=${list(b.then)}/>
    ${(b.elifs || []).map(e => html`<${Line} k=${t('rule_elseif')} cls="if" items=${[e.cond || '…']}/>
      <${Line} k=${t('rule_then')} cls="then" items=${list(e.then)}/>`)}
    ${b.else ? html`<${Line} k=${t('rule_else')} cls="else" items=${list(b.else)}/>` : null}
    <div class="row tight">
      <button class="b" onClick=${onEdit}>${t('rule_editBlock')}</button>
      <button class="b" onClick=${onDelete}>${t('rule_deleteBlock')}</button>
    </div>
  </div>`;
}

// One trigger: what it waits for (a list of events), then how its value is compared. `n` is its
// number among the triggers of the sentence (1 for the first, which keeps the field names the
// form had before there could be several).
function TriggerRow({ tr, n, change, remove, trig, s }) {
  const sfx = n > 1 ? ' ' + n : '';
  const label = n > 1 ? t('rule_or').replace(/^./, c => c.toUpperCase()) + sfx : t('rule_when');   // "Ou 2"
  const plain = describeConnection(tr, s.devices, conn());            // a device connecting: the list item says it all
  return html`<div class="trig">
    <div class="row tight">
      <${Choice} label=${label} value=${tr.subject} groups=${trig.groups} placeholder=${t('rule_pickEvent')}
        isSel=${i => i.value === tr.subject && (i.op == null || (i.op === tr.op && i.val === tr.value))}
        friendly=${plain || (tr.subject ? (describeSubject(tr.subject, s.devices, s.zbNames) || tr.subject) : '')}
        onChange=${(v, i) => change(i && i.op != null ? { subject: v, op: i.op, value: i.val } : { subject: v })}/>
      ${remove ? html`<button class="b" aria-label=${t('rule_removeTrigger') + sfx} onClick=${remove}>×</button>` : null}
    </div>
    ${plain ? null : html`<div class="row tight">
      <select aria-label=${t('rule_operator') + sfx} value=${tr.op} onChange=${e => change({ op: e.target.value, value: e.target.value ? tr.value : '' })}>
        <option value="">${t('rule_anyValue')}</option>
        ${OPERATORS.map(o => html`<option value=${o}>${o}</option>`)}
        ${tr.op && !OPERATORS.includes(tr.op) ? html`<option value=${tr.op}>${tr.op}</option>` : null}
      </select>
      ${tr.op ? html`<input class="grow" value=${tr.value} aria-label=${t('rule_value') + sfx} placeholder="3" onInput=${e => change({ value: e.target.value })}/>` : null}
    </div>`}
  </div>`;
}

function BlockForm({ b, change, s }) {
  const hasCond = b.cond != null;
  const trig = triggerGroups(s);
  const acts = actionGroups(s);
  const more = b.more || [];
  const elifs = b.elifs || [];
  const putMore = (i, p) => change({ more: more.map((x, k) => k === i ? { ...x, ...p } : x) });
  const putElif = (i, p) => change({ elifs: elifs.map((x, k) => k === i ? { ...x, ...p } : x) });
  return html`<div class="form">
    <fieldset class="cmds"><legend>${t('rule_when')}</legend>
      <${TriggerRow} tr=${b} n=${1} change=${change} trig=${trig} s=${s}/>
      ${more.map((tr, i) => html`<${TriggerRow} key=${i} tr=${tr} n=${i + 2} change=${p => putMore(i, p)} remove=${() => change({ more: more.filter((_, k) => k !== i) })} trig=${trig} s=${s}/>`)}
      ${trig.skipped ? html`<div class="q">${t('rule_zbSkipped')}</div>` : null}
      <button class="b" onClick=${() => change({ more: [...more, { subject: '', op: '', value: '' }] })}>${t('rule_addTrigger')}</button>
    </fieldset>
    <fieldset class="cmds"><legend><label><input type="checkbox" checked=${hasCond} onChange=${e => change({ cond: e.target.checked ? '' : null, elifs: [], else: null })}/> ${t('rule_if')}</label></legend>
      ${hasCond ? html`<input class="grow" value=${b.cond} aria-label=${t('rule_if')} placeholder="Var1==1" onInput=${e => change({ cond: e.target.value })}/>` : html`<span class="q">${t('rule_noCond')}</span>`}
    </fieldset>
    <${Commands} label=${t('rule_then')} list=${b.then} set=${v => change({ then: v })} groups=${acts} s=${s}/>
    ${hasCond ? elifs.map((e, i) => html`<fieldset class="cmds"><legend>${t('rule_elseif') + ' ' + (i + 1)}</legend>
      <div class="row tight"><input class="grow" value=${e.cond} aria-label=${t('rule_elseif') + ' ' + (i + 1)} placeholder="Var1==2" onInput=${ev => putElif(i, { cond: ev.target.value })}/>
        <button class="b" aria-label=${t('rule_removeElseif') + ' ' + (i + 1)} onClick=${() => change({ elifs: elifs.filter((_, k) => k !== i) })}>×</button></div>
      <${Commands} label=${t('rule_then') + ' (' + t('rule_elseif') + ' ' + (i + 1) + ')'} list=${e.then} set=${v => putElif(i, { then: v })} groups=${acts} s=${s} bare=${true}/>
    </fieldset>`) : null}
    ${hasCond ? html`<div class="row tight"><button class="b" onClick=${() => change({ elifs: [...elifs, { cond: '', then: [''] }] })}>${t('rule_addElseif')}</button></div>` : null}
    ${hasCond ? html`<fieldset class="cmds"><legend><label><input type="checkbox" checked=${!!b.else} onChange=${e => change({ else: e.target.checked ? [''] : null })}/> ${t('rule_else')}</label></legend>
      ${b.else ? html`<${Commands} label=${t('rule_else')} list=${b.else} set=${v => change({ else: v })} groups=${acts} s=${s} bare=${true}/>` : html`<span class="q">${t('rule_noElse')}</span>`}</fieldset>` : null}
  </div>`;
}

// text: the rule set as written now; setText(newText) after every change
export function SentenceEditor({ text, setText }) {
  const s = S.get();                                 // devices, Tuya, SetOption83
  const [blocks, setBlocks] = useState(() => parseRuleSet(text));
  const [open, setOpen] = useState(-1);
  const [guided, setGuided] = useState(false);
  if (!blocks) return html`<p class="q">${t('rule_noSentence')}</p>`;
  const commit = list => { setBlocks(list); setText(serializeRuleSet(list)); };
  const change = (i, patch) => commit(blocks.map((b, k) => k === i ? edited(b, patch) : b));
  const cur = open >= 0 ? blocks[open] : null;
  const off = Object.keys(s.drivers).some(k => k !== 'tuyaWhy' && s.drivers[k] && s.drivers[k] !== 'running' && s.drivers[k] !== 'absent');
  return html`${off ? html`<p class="q" role="status">${t('rule_driverNote')}</p>` : null}<div class="tiles">
    ${blocks.map((b, i) => html`<${Tile} key=${i} b=${b} s=${s} onEdit=${() => setOpen(i)} onDelete=${() => { commit(blocks.filter((_, k) => k !== i)); setOpen(-1); }}/>`)}
    <button class="tile add" onClick=${() => setGuided(true)}>＋ ${t('g_add')}</button>
    <button class="tile add" onClick=${() => { commit([...blocks, newBlock()]); setOpen(blocks.length); }}>＋ ${t('rule_addBlock')}</button>
    ${guided ? html`<${Guided} s=${s} groups=${actionGroups(s).slice(1)} verbs=${verbs()} onClose=${() => setGuided(false)}
      onCreate=${b => { commit([...blocks, b]); setGuided(false); }}
      onFree=${() => { commit([...blocks, newBlock()]); setGuided(false); setOpen(blocks.length); }}/>` : null}
    ${cur && cur.kind === 'sentence' ? html`<${Modal} title=${t('rule_editTitle')} onClose=${() => setOpen(-1)}>
      <${BlockForm} b=${cur} s=${s} change=${p => change(open, p)}/></${Modal}>` : null}
  </div>`;
}
