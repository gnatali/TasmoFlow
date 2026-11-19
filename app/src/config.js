// SPDX-License-Identifier: GPL-3.0-only
// window.TASMOFLOW is provided by the gateway's /tf page:
//   { version, port, token, api, cdn, sri, upd (update manifest), copy (local copy: 0 none,
//   1 this version's, 2 another version's) }; boot.js adds source ("github" or "local")
export default window.TASMOFLOW || {};
