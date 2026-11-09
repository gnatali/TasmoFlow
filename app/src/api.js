// SPDX-License-Identifier: GPL-3.0-only
// Client of a gateway's API (port 8384): { api, token } -> get, cmd, url
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
  return { url, get, cmd: c => get('/api/cmd', { c }) };
}
