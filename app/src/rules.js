// SPDX-License-Identifier: GPL-3.0-only
// Rules of the gateway: the three Tasmota rule sets (Rule1 to Rule3) and the Berry rules.
// Every write goes through the gateway, which keeps a copy of the previous text first (see
// extension/tf_rules.be). The light interface only enables/disables and restores.
import { useState } from 'preact/hooks';
import { html } from './html.js';
import { t } from './i18n.js';
import { S, cmd, get, loadRules } from './state.js';
import cfg from './config.js';
import { lintRule, chunks, flatRule, showRule } from './rules_lint.js';

const CHUNK = 300;           // characters per request (the port 8384 server reads a short request line)
const SOFT_LIMIT = 512;      // beyond it Tasmota compresses the text (up to about 2 KB)
const HARD_LIMIT = 2000;

export async function saveRule(n, text) {
  const parts = chunks(text, CHUNK);
  for (let i = 0; i < parts.length; i++) {
    const p = { n, i, x: parts[i] };
    if (i === parts.length - 1) p.last = 1;
    try { await get('/api/rule_set', p); }
    catch (e) { throw new Error(e.message + (parts.length > 1 ? ' (' + (i + 1) + '/' + parts.length + ')' : '')); }
  }
}

const errText = e => t('rule_' + e) === 'rule_' + e ? e : t('rule_' + e);

function RuleCard({ r, note, setNote }) {
  const [text, setText] = useState(showRule(r.text));
  const [busy, setBusy] = useState(false);
  const flat = flatRule(text);
  const dirty = flat !== flatRule(r.text);
  const lint = dirty ? lintRule(flat) : null;
  const tooLong = flat.length > HARD_LIMIT;
  const run = async (what, f) => {
    setBusy(true);
    try { await f(); await loadRules(); setNote({ n: r.n, ok: true, text: t(what) }); }
    catch (e) { setNote({ n: r.n, ok: false, text: errText(e.message) }); }
    setBusy(false);
  };
  const flag = (on, opt) => run('rule_done', () => cmd('Rule' + r.n + ' ' + opt[on ? 1 : 0]));
  const save = () => run('rule_saved', () => saveRule(r.n, flat));
  const restore = () => {
    if (confirm(t('rule_confirmRestore'))) run('rule_restored', () => get('/api/rule_restore', { n: r.n }));
  };
  const mine = note && note.n === r.n ? note : null;
  return html`<article class="card">
    <h3>${'Rule' + r.n}</h3>
    <div class="row tight">
      <button class="b" aria-pressed=${r.on} disabled=${busy} onClick=${() => flag(!r.on, ['0', '1'])}>${r.on ? t('on') : t('off')}</button>
      ${cfg.lite ? null : html`
        <label><input type="checkbox" checked=${r.once} disabled=${busy} onChange=${e => flag(e.target.checked, ['4', '5'])}/> ${t('rule_once')}</label>
        <label><input type="checkbox" checked=${r.stop} disabled=${busy} onChange=${e => flag(e.target.checked, ['8', '9'])}/> ${t('rule_stop')}</label>`}
      <span class="q">${r.len + ' ' + t('rule_chars') + ' · ' + t('rule_free') + ' ' + r.free}</span>
    </div>
    ${cfg.lite
      ? html`<pre>${showRule(r.text) || t('rule_empty')}</pre>`
      : html`<textarea class="mono" rows=${Math.min(14, Math.max(4, text.split('\n').length + 1))} spellcheck=${false}
          aria-label=${'Rule' + r.n} value=${text} onInput=${e => setText(e.target.value)}></textarea>
        ${lint ? html`<div class="msg bad" role="alert">${t('rule_' + lint)}</div>` : null}
        ${tooLong ? html`<div class="msg bad" role="alert">${t('rule_tooLong')}</div>` : null}
        ${!lint && !tooLong && flat.length > SOFT_LIMIT ? html`<div class="q">${t('rule_compressed')}</div>` : null}
        <div class="row tight">
          <button class="b" disabled=${busy || !dirty || !!lint || tooLong} onClick=${save}>${t('rule_save')}</button>
          <button class="b" disabled=${busy || !dirty} onClick=${() => setText(showRule(r.text))}>${t('rule_cancel')}</button>
        </div>`}
    ${r.bak == null ? null : html`<details>
      <summary>${t('rule_previous')}</summary>
      <pre>${showRule(r.bak) || t('rule_empty')}</pre>
      <div class="row tight"><button class="b" disabled=${busy} onClick=${restore}>${t('rule_restore')}</button></div>
    </details>`}
    ${mine ? html`<div class=${'msg ' + (mine.ok ? 'ok' : 'bad')} role=${mine.ok ? 'status' : 'alert'}>${mine.text}</div>` : null}
  </article>`;
}

export function RulesView() {
  const { rules } = S.use();
  const [note, setNote] = useState(null);
  if (!rules) return html`<p>${t('loading')}</p>`;
  return html`
    <div class="grid wide">${rules.rules.map(r => html`<${RuleCard} key=${r.n + '|' + r.text + '|' + r.on + r.once + r.stop + '|' + r.bak} r=${r} note=${note} setNote=${setNote}/>`)}</div>
    <h2>${t('rule_berry')}</h2>
    ${rules.berry.length ? html`<ul class="berry">${rules.berry.map(b => html`<li><code>${b.rule}</code> <span class="q">${b.id === 'None' ? '' : b.id}</span></li>`)}</ul>`
      : html`<p class="q">${t('rule_noBerry')}</p>`}`;
}
