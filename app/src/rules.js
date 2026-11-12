// SPDX-License-Identifier: GPL-3.0-only
// Rules of the gateway: the three Tasmota rule sets (Rule1 to Rule3) and the Berry rules.
// Every write goes through the gateway, which keeps a copy of the previous text first (see
// extension/tf_rules.be). Full interface only: the light one (main_lite.js) has no Rules screen.
import { useState, useEffect } from 'preact/hooks';
import { html } from './html.js';
import { t } from './i18n.js';
import { S, cmd, get, post, current, fail, guardLeave } from './state.js';
import { lintRule, flatRule, showRule } from './rules_lint.js';

// the sentence editor, registered by the full interface only (not part of the light bundle)
let Editor = null;
let Banner = null;                                  // the list of rules that clash, same story
let clashes = () => [];                             // findConflicts(), for the warning sign on a section
export const registerEditor = (c, banner, find) => { Editor = c; Banner = banner || null; clashes = find || (() => []); };

// the rule sets and the Berry rules of the gateway shown (registered by main.js with onTab())
export function loadRules() {
  const gw = S.get().gw;
  cmd('SetOption83').then(r => { if (current(gw)) S.set({ zbNames: /^(ON|1)$/i.test(String((r || {}).SetOption83)) }); })
    .catch(() => {});
  return get('/api/rules').then(rules => { if (current(gw)) S.set({ rules, error: null }); })
    .catch(e => fail(gw, e));
}

const SOFT_LIMIT = 512;      // beyond it Tasmota compresses the text (up to about 2 KB)
const HARD_LIMIT = 2000;

// Sends the text (POST body), then applies it in three requests (copy of the previous text,
// write, read back): the step is named in the error, and a text that did not stay is replaced
// by the copy. Each step is its own request so that one that makes the gateway restart is known.
export async function saveRule(n, text) {
  const step = async (what, p) => {
    try { await get(what, p); }
    catch (e) { throw new Error(e.message + ' (' + p.step + ')'); }
  };
  try { await post('/api/rule_set', { n }, text); }
  catch (e) { throw new Error(e.message + ' (text)'); }
  await step('/api/rule_apply', { n, step: 'bak' });
  try {
    await step('/api/rule_apply', { n, step: 'put' });
    await step('/api/rule_apply', { n, step: 'check' });
  } catch (e) {
    await get('/api/rule_restore', { n }).catch(() => {});
    throw e;
  }
}

// The texts being edited and not saved, { n: { flat, invalid } }, kept by the cards: what the screen
// asks about before it closes a section, leaves for another screen or another gateway, or the page goes.
const pending = {};

// Before something that would drop them: the user is asked, rule set by rule set, to save the texts not
// saved yet. True when nothing is left to lose (all saved, or none pending); false when the user
// refuses or a text is not valid (it is said, and nothing is lost: the screen stays as it is).
async function settle(ns, setNote) {
  const todo = ns.filter(n => pending[n]);
  const bad = todo.find(n => pending[n].invalid);
  if (bad) { setNote({ n: bad, ok: false, text: t('rule_unsavedBad') }); return false; }
  for (const n of todo) {
    if (!confirm(t('rule_unsavedAskN').replace('{n}', n))) return false;
    try { await saveRule(n, pending[n].flat); } catch (e) { setNote({ n, ok: false, text: errText(e.message) }); return false; }
    delete pending[n];
  }
  if (todo.length) await loadRules();
  return true;
}

if (typeof window !== 'undefined') {       // closing the page: the browser's own question
  window.addEventListener('beforeunload', e => { if (Object.keys(pending).length) { e.preventDefault(); e.returnValue = ''; } });
}

const errText = e => t('rule_' + e) === 'rule_' + e ? e : t('rule_' + e);

function RuleCard({ r, note, setNote, mode, setMode }) {
  const [text, setText] = useState(showRule(r.text));
  const [v, setV] = useState(0);                      // new editor state when the text changed elsewhere
  const [busy, setBusy] = useState(false);
  const flat = flatRule(text);
  const dirty = flat !== flatRule(r.text);
  const lint = dirty ? lintRule(flat) : null;
  const tooLong = flat.length > HARD_LIMIT;
  useEffect(() => {
    if (dirty) pending[r.n] = { flat, invalid: !!lint || tooLong };
    return () => { delete pending[r.n]; };
  }, [dirty, flat, !!lint, tooLong]);
  const run = async (what, f) => {
    setBusy(true);
    try { await f(); await loadRules(); setNote({ n: r.n, ok: true, text: t(what) }); }
    catch (e) { setNote({ n: r.n, ok: false, text: errText(e.message) }); }
    setBusy(false);
  };
  // On/off, once, stop on error act on the gateway at once and rebuild the card with what it holds:
  // a text not saved yet would be lost, so it is saved first (the user is asked), or nothing happens.
  // `box`: the checkbox clicked, put back as it was when nothing is done (the screen would show a state the gateway does not have)
  const flag = (on, opt, box) => {
    const go = () => cmd('Rule' + r.n + ' ' + opt[on ? 1 : 0]);
    if (!dirty) return run('rule_done', go);
    if (box) box.checked = !on;
    if (lint || tooLong) return setNote({ n: r.n, ok: false, text: t('rule_unsavedBad') });
    if (!confirm(t('rule_unsavedAsk'))) return;
    run('rule_saved', async () => { await saveRule(r.n, flat); await go(); });
  };
  const save = () => run('rule_saved', () => saveRule(r.n, flat));
  const restore = () => {
    if (confirm(t('rule_confirmRestore'))) run('rule_restored', () => get('/api/rule_restore', { n: r.n }));
  };
  const mine = note && note.n === r.n ? note : null;
  return html`<article class="card">
    <div class="row tight">
      <button class="b" aria-pressed=${r.on} disabled=${busy} onClick=${() => flag(!r.on, ['0', '1'])}>${r.on ? t('on') : t('off')}</button>
      <label><input type="checkbox" checked=${r.once} disabled=${busy} onChange=${e => flag(e.target.checked, ['4', '5'], e.target)}/> ${t('rule_once')}</label>
      <label><input type="checkbox" checked=${r.stop} disabled=${busy} onChange=${e => flag(e.target.checked, ['8', '9'], e.target)}/> ${t('rule_stop')}</label>
      <span class="q">${r.len + ' ' + t('rule_chars') + ' · ' + t('rule_free') + ' ' + r.free}</span>
    </div>
    ${Editor ? html`<div class="row tight" role="group" aria-label=${t('rule_view')}>
      <button class="b" aria-pressed=${mode === 'sentences'} onClick=${() => { setMode('sentences'); setV(v + 1); }}>${t('rule_sentences')}</button>
      <button class="b" aria-pressed=${mode === 'text'} onClick=${() => setMode('text')}>${t('rule_text')}</button>
    </div>` : null}
    ${mode === 'sentences' && Editor
      ? html`<${Editor} key=${v} text=${text} setText=${setText}/>`
      : html`<textarea class="mono" rows=${Math.min(14, Math.max(4, text.split('\n').length + 1))} spellcheck=${false}
      aria-label=${'Rule' + r.n} value=${text} onInput=${e => setText(e.target.value)}></textarea>`}
    ${lint ? html`<div class="msg bad" role="alert">${t('rule_' + lint)}</div>` : null}
    ${tooLong ? html`<div class="msg bad" role="alert">${t('rule_tooLong')}</div>` : null}
    ${!lint && !tooLong && flat.length > SOFT_LIMIT ? html`<div class="q">${t('rule_compressed')}</div>` : null}
    <div class="row tight">
      <button class="b" disabled=${busy || !dirty || !!lint || tooLong} onClick=${save}>${t('rule_save')}</button>
      <button class="b" disabled=${busy || !dirty} onClick=${() => { setText(showRule(r.text)); setV(v + 1); }}>${t('rule_cancel')}</button>
    </div>
    ${r.bak == null ? null : html`<details>
      <summary>${t('rule_previous')}</summary>
      <pre>${showRule(r.bak) || t('rule_empty')}</pre>
      <div class="row tight"><button class="b" disabled=${busy} onClick=${restore}>${t('rule_restore')}</button></div>
    </details>`}
    ${mine ? html`<div class=${'msg ' + (mine.ok ? 'ok' : 'bad')} role=${mine.ok ? 'status' : 'alert'}>${mine.text}</div>` : null}
  </article>`;
}

// who registered a Berry rule: its id, or the class of the object that did
const owner = id => { const m = /^<instance: ([^(>]+)/.exec(id); return m ? m[1] : (id === 'nil' || id === 'None' ? '' : id); };

// Berry rules (read only) and the script that usually creates them, autoexec.be (read only too)
function BerryRules({ berry }) {
  const [auto, setAuto] = useState(null);
  useEffect(() => { get('/api/autoexec').then(setAuto).catch(() => setAuto({ error: true })); }, []);
  return html`${berry.length
      ? html`<ul class="berry">${berry.map(b => html`<li><code>${b.rule}</code> <span class="q">${owner(b.id)}</span></li>`)}</ul>`
      : html`<p class="q">${t('rule_noBerry')}</p>`}
    <h4>autoexec.be</h4>
    ${!auto ? html`<p class="q">${t('loading')}</p>`
      : auto.error ? html`<p class="q">${t('error')}</p>`
      : !auto.exists ? html`<p class="q">${t('rule_autoexecNone')}</p>`
      : html`<pre class="code">${auto.text}</pre>
        <p class="q">${auto.text.length < auto.size ? t('rule_autoexecCut').replace('{n}', auto.text.length).replace('{size}', auto.size) + ' ' : ''}${t('rule_autoexecHelp')}</p>`}`;
}

// An accordion section. Defined here, not inside RulesView: a component created at every render
// is a new type each time, and Preact would rebuild everything below it (the text being edited
// included) whenever an event arrives.
function Section({ title, dot, warn, open, toggle, children }) {
  return html`<section class="acc">
    <h3><button class="acc-h" aria-expanded=${open} onClick=${toggle}>
      ${dot == null ? null : html`<span class=${'dot' + (dot ? ' on' : '')} aria-hidden="true"></span>`}<span class="acc-t">${title}</span>${warn ? html`<span class="warn" role="img" aria-label=${t('rule_conflicts')} title=${t('rule_conflicts')}>⚠</span>` : null}<span class="caret" aria-hidden="true">▾</span></button></h3>
    ${open ? html`<div class="acc-b" role="region" aria-label=${title}>${children}</div>` : null}
  </section>`;
}

export function RulesView() {
  const { rules } = S.get();
  const [note, setNote] = useState(null);
  const [modes, setModes] = useState({});               // view of each rule set: 'text' (default) | 'sentences'; kept when a card is rebuilt
  const [open, setOpen] = useState({ 1: true });        // accordion: each section opens and closes on its own
  // the Rules screen answers for what is unsaved when the tab or the gateway changes
  useEffect(() => { guardLeave(() => settle(Object.keys(pending).map(Number), setNote)); return () => guardLeave(null); }, []);
  if (!rules) return html`<p>${t('loading')}</p>`;
  // closing a section drops its card: a text not saved yet is asked about first
  const toggle = k => async () => {
    if (open[k] && k && !(await settle([k], setNote))) return;
    setOpen(o => ({ ...o, [k]: !o[k] }));
  };
  const flagged = new Set(clashes(rules.rules).flatMap(c => c.where.map(w => w.n)));      // sets with a rule that clashes
  return html`${Banner ? html`<${Banner} rules=${rules.rules}/>` : null}<div class="accs">
    ${rules.rules.map(r => html`<${Section} key=${r.n} title=${'Rule' + r.n + (r.on ? '' : ' · ' + t('off'))} dot=${r.on} warn=${flagged.has(r.n)} open=${!!open[r.n]} toggle=${toggle(r.n)}>
      <${RuleCard} key=${r.n + '|' + r.text + '|' + r.on + r.once + r.stop + '|' + r.bak} r=${r} note=${note} setNote=${setNote}
        mode=${modes[r.n] || 'text'} setMode=${m => setModes({ ...modes, [r.n]: m })}/></${Section}>`)}
    <${Section} key="berry" title=${t('rule_berry') + ' (' + rules.berry.length + ')'} open=${!!open[0]} toggle=${toggle(0)}>
      <${BerryRules} berry=${rules.berry}/></${Section}>
  </div>`;
}
