// SPDX-License-Identifier: GPL-3.0-only
// Client of a gateway's API (port 8384): { api, token } -> get, cmd, url
export function client(gw) {
  const url = (path, params) => {
    let u = gw.api + path + '?t=' + encodeURIComponent(gw.token);
    for (const k in params || {}) u += '&' + k + '=' + encodeURIComponent(params[k]);
    return u;
  };
  const get = (path, params) => fetch(url(path, params)).then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
  return { url, get, cmd: c => get('/api/cmd', { c }) };
}
