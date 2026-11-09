// SPDX-License-Identifier: GPL-3.0-only
// Other gateways, kept in the browser (localStorage of the gateway's page).
const KEY = 'tf-gateways';

export function loadRemotes() {
  try {
    const l = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(l) ? l.filter(g => g && g.id && g.api && g.token) : [];
  } catch (e) { return []; }
}

export function saveRemotes(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

// "host[:port]#token", also with a leading http://: returns { api, token } or null
export function parseLink(s) {
  const m = /^(?:https?:\/\/)?([A-Za-z0-9._-]+)(?::(\d{1,5}))?\/?#([0-9a-fA-F]{32})$/.exec(String(s).trim());
  if (!m || (m[2] && +m[2] > 65535)) return null;
  return { api: 'http://' + m[1] + ':' + (m[2] || '8384'), token: m[3].toLowerCase() };
}

export function makeLink(host, port, token) {
  return host + ':' + port + '#' + token;
}
