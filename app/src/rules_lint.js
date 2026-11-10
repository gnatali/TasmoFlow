// SPDX-License-Identifier: GPL-3.0-only
// Advisory syntax check of a Tasmota rule set: `on <trigger> do <commands> endon`, repeated.
// (`on` and `endon` inside the commands are arguments, e.g. `Power1 on`: only the first `do`
// after a trigger and the next `endon` count.) Returns an error code or null.
export function lintRule(text) {
  let rest = text.trim();
  while (rest) {
    const m = /^on\s+(\S[^]*?)\s+do(?=\s|$)/i.exec(rest);
    if (!/^on\s/i.test(rest)) return 'lintOn';
    if (!m) return 'lintDo';
    rest = rest.slice(m[0].length);
    const e = /\bendon\b/i.exec(rest);
    if (!e) return 'lintEndon';
    if (!rest.slice(0, e.index).trim()) return 'lintBody';
    rest = rest.slice(e.index + e[0].length).trim();
  }
  return null;
}

// Line breaks never go to the gateway: a rule text sent with one made the gateway drop the
// connection (see docs/architecture.en.md, Rules). A rule set is stored on one line, and shown
// with one `on ... endon` block per line.
export const flatRule = text => text.replace(/\s*[\r\n]+\s*/g, ' ').trim();

export function showRule(text) {
  const out = [];
  let rest = flatRule(text);
  while (rest) {
    const m = /^on\s+\S[^]*?\s+do(?=\s|$)/i.exec(rest);
    if (!m) return text;                          // not a plain list of blocks: shown as it is
    const e = /\bendon\b/i.exec(rest.slice(m[0].length));
    if (!e) return text;
    const end = m[0].length + e.index + e[0].length;
    out.push(rest.slice(0, end));
    rest = rest.slice(end).trim();
  }
  return out.join('\n');
}
