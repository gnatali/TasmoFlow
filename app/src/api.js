// SPDX-License-Identifier: GPL-3.0-only
// Client of a gateway's API (port 8384): { api, token } -> get, post, cmd, url
export function client(gw) {
  const url = (path, params) => {
    let u = gw.api + path + '?t=' + encodeURIComponent(gw.token);
    for (const k in params || {}) u += '&' + k + '=' + encodeURIComponent(params[k]);
    return u;
  };
  // an error answer {"error": code} becomes the Error's message, else 'HTTP <status>'
  const get = (path, params) => fetch(url(path, params)).then(r => r.json().catch(() => ({})).then(b => {
    if (!r.ok) throw new Error(b.error || 'HTTP ' + r.status);
    return b;
  }));
  // POST, for anything long: a URL of more than about 130 characters made the gateway restart.
  // text/plain keeps it a "simple" cross-origin request (no preflight).
  const post = (path, params, body) => fetch(url(path, params), { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } })
    .then(r => r.json().catch(() => ({})).then(b => {
      if (!r.ok) throw new Error(b.error || 'HTTP ' + r.status);
      return b;
    }));
  return { url, get, post, cmd: c => post('/api/cmd', {}, c) };
}
