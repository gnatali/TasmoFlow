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

// Cuts a text into pieces small enough for a short request line (the gateway's API server
// only reads one packet of it): chunks of `size` characters, at least one.
export function chunks(text, size) {
  const out = [];
  for (let o = 0; o < text.length; o += size) out.push(text.slice(o, o + size));
  return out.length ? out : [''];
}
