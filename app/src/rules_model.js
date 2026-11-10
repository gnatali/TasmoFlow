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

export function parseBlock(text) {
  const m = /^on\s+(\S[^]*?)\s+do(?:\s+([^]*?))?\s+endon$/i.exec(text);
  if (!m) return raw(text);
  const trig = TRIGGER.exec(m[1]);
  if (/\s(and|or)\s/i.test(m[1]) || !trig || (trig[2] && !trig[3])) return raw(text);
  const body = (m[2] || '').trim();
  if (!body) return raw(text);
  const b = { kind: 'sentence', subject: trig[1], op: trig[2] || '', value: trig[3] || '', cond: null, then: [], else: null, src: text };
  if (/^if\s*\(/i.test(body)) {
    const open = body.indexOf('(');
    const close = closing(body, open);
    if (close < 0) return raw(text);
    const rest = body.slice(close + 1).trim();
    const e = /^([^]*?)(?:\s+else\s+([^]*?))?\s*\bendif$/i.exec(rest);
    if (!e || /\b(if|elseif)\b/i.test(rest)) return raw(text);
    b.cond = body.slice(open + 1, close).trim();
    b.then = parseCommands(e[1]);
    b.else = e[2] != null ? parseCommands(e[2]) : null;
    if (!b.cond || !b.then.length) return raw(text);
  } else {
    if (/\b(if|elseif|else|endif)\b/i.test(body)) return raw(text);
    b.then = parseCommands(body);
  }
  return b;
}

// null if the text is not a plain list of blocks
export function parseRuleSet(text) {
  const blocks = splitBlocks(text);
  return blocks ? blocks.map(parseBlock) : null;
}

export function serializeBlock(b) {
  if (b.src != null) return b.src;
  const trig = b.subject.trim() + (b.op ? b.op + b.value.trim() : '');
  let body = writeCommands(b.then);
  if (b.cond != null) {
    body = 'if (' + b.cond.trim() + ') ' + body;
    if (b.else) body += ' else ' + writeCommands(b.else);
    body += ' endif';
  }
  return 'on ' + trig + ' do ' + body + ' endon';
}

export const serializeRuleSet = blocks => blocks.map(serializeBlock).join('\n');

export const newBlock = () => ({ kind: 'sentence', subject: '', op: '', value: '', cond: null, then: [''], else: null, src: null });

// the same block, edited: forget the original text so that it is written again
export const edited = (b, patch) => ({ ...b, ...patch, src: null });

export { flatRule };
