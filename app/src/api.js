// SPDX-License-Identifier: GPL-3.0-only
// Client of a gateway's API (port 8384): { api, token } -> get, post, cmd, url
export function client(gw) {
  const url = (path, params) => {
    let u = gw.api + path + '?t=' + encodeURIComponent(gw.token);
    for (const k in params || {}) u += '&' + k + '=' + encodeURIComponent(params[k]);
    return u;
  };
  // an error answer {"error": code} becomes the Error's message, else 'HTTP <status>'. No answer
  // within 15 s is an error too (a request the gateway never answers used to leave the page on
  // "loading" for ever). POST, for anything long: the gateway refuses a request line over 512
  // characters (and, before 10 November 2026, restarted from about 130); text/plain keeps it a
  // "simple" cross-origin request (no preflight).
  const req = (path, params, o) => fetch(url(path, params), { signal: AbortSignal.timeout(15e3), ...o })
    .then(r => r.json().catch(() => ({})).then(b => {
      if (!r.ok) throw new Error(b.error || 'HTTP ' + r.status);
      return b;
    }));
  const get = (path, params) => req(path, params);
  const post = (path, params, body) => req(path, params, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } });
  return { url, get, post, cmd: c => post('/api/cmd', {}, c) };
}
