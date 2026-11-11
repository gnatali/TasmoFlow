// SPDX-License-Identifier: GPL-3.0-only
// Sentence editor of a rule set: "When ... If ... Then ... Else ...". Full interface only (main.js
// registers it with rules.js; the light interface does not carry it). It owns the list of blocks
// while it is open and hands the written text to the card after every change.
import { useState } from 'preact/hooks';
import { html } from './html.js';
import { t } from './i18n.js';
import { parseRuleSet, serializeRuleSet, serializeBlock, newBlock, edited, parseCommands, writeCommands, OPERATORS } from './rules_model.js';

// suggestions only: every field stays free text
const TRIGGERS = ['System#Boot', 'Time#Minute', 'Clock#Timer', 'Rules#Timer', 'Button1#State', 'Switch1#State',
  'Power1#State', 'Wifi#Connected', 'Wifi#Disconnected', 'Mqtt#Connected', 'Tele-ENERGY#Power'];
const ACTIONS = ['Power1 on', 'Power1 off', 'Power1 toggle', 'Power2 toggle', 'Var1 ', 'Mem1 ', 'RuleTimer1 ', 'Delay 10', 'Restart 1'];

// A <datalist> only offers what matches the text already typed: once a field holds a value, the
// other suggestions are gone. A list that always shows everything and fills the field instead.
function Pick({ options, onPick }) {
  return html`<select class="pick" aria-label=${t('rule_suggest')} value="" onChange=${e => {
    const v = e.target.value;
    e.target.value = '';
    if (v) onPick(v);
  }}>
    <option value="">▾</option>
    ${options.map(x => html`<option value=${x}>${x.trim()}</option>`)}
  </select>`;
}

// the commands of Then / Else, one field each
function Commands({ label, list, set }) {
  const rows = list.length ? list : [''];
  const put = (i, v) => set(rows.map((x, k) => k === i ? v : x));
  return html`<fieldset class="cmds"><legend>${label}</legend>
    ${rows.map((c, i) => html`<div class="row tight">
      <input value=${c} aria-label=${label + ' ' + (i + 1)} onInput=${e => put(i, e.target.value)}/>
      <${Pick} options=${ACTIONS} onPick=${v => put(i, v)}/>
      ${rows.length > 1 ? html`<button class="b" aria-label=${t('rule_removeCmd')} onClick=${() => set(rows.filter((_, k) => k !== i))}>×</button>` : null}
    </div>`)}
    <button class="b" onClick=${() => set([...rows, ''])}>${t('rule_addCmd')}</button>
  </fieldset>`;
}

function Sentence({ b }) {
  const trig = b.subject + (b.op ? ' ' + b.op + ' ' + b.value : '');
  const list = l => l.join(' ' + t('rule_and') + ' ');
  return html`<p class="sentence">
    <b>${t('rule_when')}</b> <code>${trig || '…'}</code>${b.cond != null ? html` <b>${t('rule_if')}</b> <code>${b.cond || '…'}</code>` : null}
    ${' '}<b>${t('rule_then')}</b> <code>${list(b.then.filter(Boolean)) || '…'}</code>${b.else ? html` <b>${t('rule_else')}</b> <code>${list(b.else.filter(Boolean)) || '…'}</code>` : null}
  </p>`;
}

function BlockForm({ b, change }) {
  const hasCond = b.cond != null;
  return html`<div class="form">
    <div class="row tight">
      <label>${t('rule_when')} <input value=${b.subject} placeholder="Button1#State" onInput=${e => change({ subject: e.target.value })}/></label>
      <${Pick} options=${TRIGGERS} onPick=${v => change({ subject: v })}/>
      <select aria-label=${t('rule_operator')} value=${b.op} onChange=${e => change({ op: e.target.value, value: e.target.value ? b.value : '' })}>
        <option value="">${t('rule_anyValue')}</option>
        ${OPERATORS.map(o => html`<option value=${o}>${o}</option>`)}
        ${b.op && !OPERATORS.includes(b.op) ? html`<option value=${b.op}>${b.op}</option>` : null}
      </select>
      ${b.op ? html`<input value=${b.value} aria-label=${t('rule_value')} placeholder="3" onInput=${e => change({ value: e.target.value })}/>` : null}
    </div>
    <label><input type="checkbox" checked=${hasCond} onChange=${e => change({ cond: e.target.checked ? '' : null, else: null })}/> ${t('rule_if')}</label>
    ${hasCond ? html`<input value=${b.cond} aria-label=${t('rule_if')} placeholder="Var1==1" onInput=${e => change({ cond: e.target.value })}/>` : null}
    <${Commands} label=${t('rule_then')} list=${b.then} set=${v => change({ then: v })}/>
    ${hasCond ? html`<label><input type="checkbox" checked=${!!b.else} onChange=${e => change({ else: e.target.checked ? [''] : null })}/> ${t('rule_else')}</label>
      ${b.else ? html`<${Commands} label=${t('rule_else')} list=${b.else} set=${v => change({ else: v })}/>` : null}` : null}
  </div>`;
}

// text: the rule set as written now; setText(newText) after every change
export function SentenceEditor({ text, setText }) {
  const [blocks, setBlocks] = useState(() => parseRuleSet(text));
  const [open, setOpen] = useState(-1);
  if (!blocks) return html`<p class="q">${t('rule_noSentence')}</p>`;
  const commit = (list, o) => { setBlocks(list); setText(serializeRuleSet(list)); if (o != null) setOpen(o); };
  const change = (i, patch) => commit(blocks.map((b, k) => k === i ? edited(b, patch) : b));
  return html`<div class="blocks">
    ${blocks.length ? null : html`<p class="q">${t('rule_empty')}</p>`}
    ${blocks.map((b, i) => html`<div class="block" key=${i}>
      ${b.kind === 'raw'
        ? html`<p class="sentence"><code>${b.text}</code></p><p class="q">${t('rule_rawBlock')}</p>`
        : html`<${Sentence} b=${b}/>${open === i ? html`<${BlockForm} b=${b} change=${p => change(i, p)}/>` : null}`}
      <div class="row tight">
        ${b.kind === 'raw' ? null : html`<button class="b" aria-expanded=${open === i} onClick=${() => setOpen(open === i ? -1 : i)}>${open === i ? t('rule_closeBlock') : t('rule_editBlock')}</button>`}
        <button class="b" onClick=${() => { commit(blocks.filter((_, k) => k !== i), open === i ? -1 : null); }}>${t('rule_deleteBlock')}</button>
      </div>
    </div>`)}
    <button class="b" onClick=${() => commit([...blocks, newBlock()], blocks.length)}>${t('rule_addBlock')}</button>
  </div>`;
}
