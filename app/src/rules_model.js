// SPDX-License-Identifier: GPL-3.0-only
// Tasmota rule blocks as sentences: When <trigger> [If <condition>] Then <commands> [Else <commands>].
// parseRuleSet() turns a rule set into blocks, serializeRuleSet() writes them back. A block that
// does not fit the model (several triggers joined by and/or, nested or chained if, odd text) stays
// a `raw` block, written back unchanged; so does a sentence that was not edited (`src`): opening
// a rule set in the sentence editor never rewrites it.
import { splitBlocks, flatRule } from './rules_lint.js';

export const OPERATORS = ['=', '!=', '>', '<', '>=', '<='];
// what Tasmota calls a trigger: Subject#Key[<op><value>]
const TRIGGER = /^([^\s=<>!|]+)\s*(!=|>=|<=|<>|==|=|>|<|\|)?\s*([^]*)$/;

// index of the parenthesis closing the one at `open`, or -1
function closing(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

// `Backlog a; b` is a list, anything else one command
export function parseCommands(s) {
  s = s.trim();
  const m = /^backlog\s+([^]*)$/i.exec(s);
  if (!m) return s ? [s] : [];
  return m[1].split(';').map(x => x.trim()).filter(Boolean);
}

export function writeCommands(list) {
  const l = list.map(x => x.trim()).filter(Boolean);
  return l.length > 1 ? 'Backlog ' + l.join('; ') : (l[0] || '');
}

const raw = text => ({ kind: 'raw', text, src: text });

// The body of an `if` block, cut at its `elseif (...)` and `else` branches:
// { first, elifs: [{ cond, text }], els } (texts of commands), or null if it does not fit.
function branches(content) {
  const out = { first: '', elifs: [], els: null };
  let rest = content;
  let into = null;                                   // the elseif being read, else null for the first branch
  const put = text => { if (into) into.text = text; else out.first = text; };
  for (;;) {
    const m = /\s(elseif\s*\(|else(?=\s|$))/i.exec(rest);
    if (!m) { put(rest.trim()); break; }
    put(rest.slice(0, m.index).trim());
    if (/^else$/i.test(m[1])) { out.els = rest.slice(m.index + m[0].length).trim(); break; }
    const open = m.index + m[0].length - 1;          // the "(" of the elseif
    const close = closing(rest, open);
    if (close < 0) return null;
    into = { cond: rest.slice(open + 1, close).trim(), text: '' };
    out.elifs.push(into);
    rest = rest.slice(close + 1);
  }
  return out;
}

export function parseBlock(text) {
  const m = /^on\s+(\S[^]*?)\s+do(?:\s+([^]*?))?\s+endon$/i.exec(text);
  if (!m) return raw(text);
  const trig = TRIGGER.exec(m[1]);
  if (/\s(and|or)\s/i.test(m[1]) || !trig || (trig[2] && !trig[3])) return raw(text);
  const body = (m[2] || '').trim();
  if (!body) return raw(text);
  const b = { kind: 'sentence', subject: trig[1], op: trig[2] || '', value: trig[3] || '', more: [], cond: null, then: [], elifs: [], else: null, src: text };
  const nested = s => /\b(if|elseif|else|endif)\b/i.test(s);
  if (/^if\s*\(/i.test(body)) {
    const open = body.indexOf('(');
    const close = closing(body, open);
    if (close < 0) return raw(text);
    const e = /^([^]*?)\s*\bendif$/i.exec(body.slice(close + 1).trim());
    if (!e) return raw(text);
    const br = branches(e[1]);
    if (!br || nested(br.first) || br.elifs.some(x => !x.cond || !x.text || nested(x.text)) || (br.els != null && (!br.els || nested(br.els)))) return raw(text);
    b.cond = body.slice(open + 1, close).trim();
    b.then = parseCommands(br.first);
    b.elifs = br.elifs.map(x => ({ cond: x.cond, then: parseCommands(x.text) }));
    b.else = br.els != null ? parseCommands(br.els) : null;
    if (!b.cond || !b.then.length) return raw(text);
  } else {
    if (nested(body)) return raw(text);
    b.then = parseCommands(body);
  }
  return b;
}

const sameTrigger = (a, b) => (a.subject + a.op + a.value).replace(/\s+/g, '').toLowerCase() === (b.subject + b.op + b.value).replace(/\s+/g, '').toLowerCase();

// the same actions: what makes several blocks one sentence with several triggers
const body = b => JSON.stringify([b.cond, b.then, b.elifs, b.else]);

// Tasmota has no "or" between triggers: several triggers are several blocks with the same actions.
// Blocks that sit next to each other with the same actions are read as one sentence, which keeps
// the text of all of them (`src`), so that opening a rule set never rewrites it.
function merge(list) {
  const out = [];
  for (const b of list) {
    const last = out[out.length - 1];
    // (the same trigger twice is not several triggers: it stays two blocks, and the clash is reported)
    if (last && last.kind === 'sentence' && b.kind === 'sentence' && body(last) === body(b) && !triggersOf(last).some(t => sameTrigger(t, b))) {
      last.more.push({ subject: b.subject, op: b.op, value: b.value });
      last.src += '\n' + b.src;
    } else out.push(b);
  }
  return out;
}

// null if the text is not a plain list of blocks
export function parseRuleSet(text) {
  const blocks = splitBlocks(text);
  return blocks ? merge(blocks.map(parseBlock)) : null;
}

const trigger = t => t.subject.trim() + (t.op ? t.op + t.value.trim() : '');

// one `on ... endon` per trigger (an extra trigger left empty is not written)
export function serializeBlock(b) {
  if (b.src != null) return b.src;
  let text = writeCommands(b.then);
  if (b.cond != null) {
    text = 'if (' + b.cond.trim() + ') ' + text;
    for (const e of b.elifs || []) text += ' elseif (' + e.cond.trim() + ') ' + writeCommands(e.then);
    if (b.else) text += ' else ' + writeCommands(b.else);
    text += ' endif';
  }
  return [b, ...(b.more || []).filter(t => t.subject.trim())].map(t => 'on ' + trigger(t) + ' do ' + text + ' endon').join('\n');
}

export const serializeRuleSet = blocks => blocks.map(serializeBlock).join('\n');

export const newBlock = () => ({ kind: 'sentence', subject: '', op: '', value: '', more: [], cond: null, then: [''], elifs: [], else: null, src: null });

// the same block, edited: forget the original text so that it is written again
export const edited = (b, patch) => ({ ...b, ...patch, src: null });

// every trigger of a sentence: [{ subject, op, value }], the first one included
export const triggersOf = b => [b, ...(b.more || [])].map(t => ({ subject: t.subject, op: t.op, value: t.value }));

export { flatRule };
