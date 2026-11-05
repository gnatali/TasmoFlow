/*
 * TasmoFlow - interface web sans code pour passerelle Zigbee Tasmota
 * SPDX-License-Identifier: GPL-3.0-only
 *
 * Prototype v0.0, sans dependance ni compilation : sert de reference de taille
 * et de comportement avant le choix entre Preact et Lit.
 *
 * Chargee par la page /tf de la passerelle, qui fournit window.TASMOFLOW :
 *   { version, port, token, api, cdn, sri } ; l'interface y ajoute source ("github" ou "local")
 */
(function () {
  "use strict";
  if (window.TASMOFLOW_STARTED) return;   // la copie GitHub et la copie locale peuvent arriver toutes les deux
  window.TASMOFLOW_STARTED = true;

  var T0 = performance.now();
  var cfg = window.TASMOFLOW;
  // provenance reelle : la copie GitHub peut arriver apres le delai et la copie locale avant elle
  var me = document.currentScript && document.currentScript.src;
  if (cfg && me) cfg.source = cfg.api && me.indexOf(cfg.api) === 0 ? "local" : "github";
  var root = document.getElementById("tasmoflow") || document.body;

  // ---------------------------------------------------------------- textes
  var TEXTS = {
    fr: {
      devices: "Appareils", events: "Événements", console: "Console", diag: "Diagnostic",
      noConfig: "Ouvrez TasmoFlow depuis la passerelle : http://<adresse de la passerelle>/tf",
      loading: "Chargement…", noDevice: "Aucun appareil Zigbee.", zigbeeOff: "Zigbee n'est pas démarré.",
      live: "en direct", reconnecting: "reconnexion…", toggle: "Basculer", pair: "Appairer (60 s)",
      send: "Envoyer", cmdPlaceholder: "Commande Tasmota, ex. ZbInfo", lastSeen: "vu", battery: "batterie",
      unreachable: "injoignable", noEvent: "Aucun événement depuis l'ouverture.", source: "Interface chargée depuis",
      loadTime: "Démarrage de l'interface", heap: "Mémoire libre", ufs: "Système de fichiers libre",
      ago: "il y a", s: "s", min: "min", h: "h", d: "j", error: "Erreur", refresh: "Actualiser",
      router: "routeur", endDevice: "sur batterie ou terminal"
    },
    en: {
      devices: "Devices", events: "Events", console: "Console", diag: "Diagnostics",
      noConfig: "Open TasmoFlow from the gateway: http://<gateway address>/tf",
      loading: "Loading…", noDevice: "No Zigbee device.", zigbeeOff: "Zigbee is not started.",
      live: "live", reconnecting: "reconnecting…", toggle: "Toggle", pair: "Pair (60 s)",
      send: "Send", cmdPlaceholder: "Tasmota command, e.g. ZbInfo", lastSeen: "seen", battery: "battery",
      unreachable: "unreachable", noEvent: "No event since opening.", source: "Interface loaded from",
      loadTime: "Interface start-up", heap: "Free memory", ufs: "Free file system",
      ago: "", s: "s ago", min: "min ago", h: "h ago", d: "d ago", error: "Error", refresh: "Refresh",
      router: "router", endDevice: "battery or end device"
    }
  };
  var lang = (localStorage.getItem("tf-lang") || navigator.language || "fr").slice(0, 2) === "en" ? "en" : "fr";
  function t(k) { return TEXTS[lang][k] || k; }

  // ---------------------------------------------------------------- DOM
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  var CSS =
    ":root{--bg:#f6f7f9;--card:#fff;--ink:#1c1f24;--quiet:#5d6670;--line:#dde1e6;--accent:#1f6feb;--bad:#c62828;--good:#2e7d32}" +
    "@media(prefers-color-scheme:dark){:root{--bg:#14171b;--card:#1d2126;--ink:#e8eaed;--quiet:#9aa3ad;--line:#2f353c;--accent:#58a6ff;--bad:#ef5350;--good:#66bb6a}}" +
    "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,sans-serif}" +
    "header{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1rem;padding:.75rem 1rem;background:var(--card);border-bottom:1px solid var(--line)}" +
    "header h1{font-size:1.1rem;margin:0}header .gw{color:var(--quiet)}header .sp{flex:1}" +
    ".badge{font-size:.75rem;padding:.1rem .5rem;border:1px solid var(--line);border-radius:1rem;color:var(--quiet)}" +
    ".badge.ok{color:var(--good);border-color:var(--good)}.badge.bad{color:var(--bad);border-color:var(--bad)}" +
    "nav{display:flex;gap:.25rem;padding:.5rem 1rem;overflow-x:auto;background:var(--card);border-bottom:1px solid var(--line)}" +
    "nav button,button.b{font:inherit;padding:.4rem .9rem;border-radius:.5rem;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}" +
    "nav button[aria-current=page]{background:var(--accent);border-color:var(--accent);color:#fff}" +
    "button.b:hover,nav button:hover{border-color:var(--accent)}button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
    "main{padding:1rem;max-width:72rem;margin:0 auto}" +
    ".grid{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))}" +
    ".card{background:var(--card);border:1px solid var(--line);border-radius:.75rem;padding:.75rem 1rem}" +
    ".card h3{margin:0 0 .25rem;font-size:1rem}.q{color:var(--quiet);font-size:.85rem}" +
    ".st{display:flex;flex-wrap:wrap;gap:.25rem .75rem;margin:.5rem 0}.st b{font-weight:600}" +
    ".row{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.75rem}input{font:inherit;flex:1;min-width:12rem;padding:.4rem .6rem;border-radius:.5rem;border:1px solid var(--line);background:var(--card);color:var(--ink)}" +
    "pre{margin:0;padding:.75rem;overflow:auto;background:var(--card);border:1px solid var(--line);border-radius:.5rem;font-size:.8rem}" +
    "ol.ev{list-style:none;margin:0;padding:0}ol.ev li{padding:.4rem 0;border-bottom:1px solid var(--line);font-size:.85rem;word-break:break-word}" +
    "dl{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem}dt{color:var(--quiet)}dd{margin:0}";
  document.head.appendChild(h("style", null, CSS));
  document.documentElement.lang = lang;

  if (!cfg || !cfg.api || !cfg.token) {
    clear(root);
    append(root, h("main", null, h("p", null, t("noConfig"))));
    return;
  }

  // ---------------------------------------------------------------- API
  function url(path, params) {
    var u = cfg.api + path + "?t=" + encodeURIComponent(cfg.token);
    if (params) for (var k in params) u += "&" + k + "=" + encodeURIComponent(params[k]);
    return u;
  }
  function get(path, params) {
    return fetch(url(path, params)).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function cmd(c) { return get("/api/cmd", { c: c }); }

  // ---------------------------------------------------------------- etat
  var state = {
    tab: "devices",
    status: null,
    devices: null,          // { "0x1234": { addr, name, model, ..., attrs: {} } }
    events: [],
    lastSeq: 0,
    live: false,
    error: null
  };

  function loadStatus() {
    return get("/api/status").then(function (s) { state.status = s; render(); })
      .catch(function (e) { state.error = e.message; render(); });
  }
  function loadDevices() {
    return get("/api/devices").then(function (list) {
      var m = {};
      list.forEach(function (d) { d.attrs = d.info || {}; m[d.addr] = d; });
      state.devices = m;
      render();
    }).catch(function (e) { state.error = e.message; render(); });
  }

  // flux d'evenements (Server-Sent Events) sur le port de l'API
  var es;
  function connectEvents() {
    if (es) es.close();
    es = new EventSource(url("/api/events", { since: state.lastSeq }));
    es.onopen = function () { state.live = true; renderHeader(); };
    es.onerror = function () { state.live = false; renderHeader(); };
    es.onmessage = function (m) {
      var ev;
      try { ev = JSON.parse(m.data); } catch (e) { return; }
      if (ev.seq <= state.lastSeq) return;      // deja recu avant une reconnexion
      state.lastSeq = ev.seq;
      state.events.unshift(ev);
      if (state.events.length > 100) state.events.pop();
      if (ev.type === "zigbee" && state.devices) {
        var d = state.devices[ev.device];
        if (d) {
          for (var k in ev.attrs) d.attrs[k] = ev.attrs[k];
          if (ev.attrs.LinkQuality != null) d.lqi = ev.attrs.LinkQuality;
          d.lastseen = 0;
          d.seenAt = Date.now();
        } else {
          loadDevices();                            // appareil nouveau ou renomme
        }
      }
      if (state.tab === "devices" || state.tab === "events") renderMain();
    };
  }

  // ---------------------------------------------------------------- rendu
  var header = h("header");
  var nav = h("nav", { "aria-label": "TasmoFlow" });
  var main = h("main", { "aria-live": "polite" });
  clear(root);
  root.removeAttribute("style");
  append(root, [header, nav, main]);

  function render() { renderHeader(); renderNav(); renderMain(); }

  function renderHeader() {
    clear(header);
    var name = state.status && state.status.device_name;
    append(header, [
      h("h1", null, "TasmoFlow"),
      name ? h("span", { class: "gw" }, name) : null,
      h("span", { class: "sp" }),
      h("span", { class: "badge " + (state.live ? "ok" : "bad") }, state.live ? t("live") : t("reconnecting")),
      h("span", { class: "badge" }, "v" + cfg.version + " · " + cfg.source),
      h("button", { class: "b", lang: lang === "fr" ? "en" : "fr",
                    "aria-label": lang === "fr" ? "English" : "Français", onclick: function () {
        lang = lang === "fr" ? "en" : "fr";
        localStorage.setItem("tf-lang", lang);
        document.documentElement.lang = lang;
        render();
      } }, lang === "fr" ? "EN" : "FR")
    ]);
  }

  function renderNav() {
    clear(nav);
    ["devices", "events", "console", "diag"].forEach(function (k) {
      append(nav, h("button", { "aria-current": state.tab === k ? "page" : null, onclick: function () {
        state.tab = k;
        if (k === "diag") loadStatus();
        renderNav(); renderMain();
      } }, t(k)));
    });
  }

  function renderMain() {
    clear(main);
    if (state.error) append(main, h("p", { class: "badge bad" }, t("error") + " : " + state.error));
    ({ devices: viewDevices, events: viewEvents, console: viewConsole, diag: viewDiag })[state.tab]();
  }

  function ago(sec) {
    if (sec == null) return "?";
    var u = sec < 60 ? [sec, "s"] : sec < 3600 ? [Math.round(sec / 60), "min"] :
            sec < 86400 ? [Math.round(sec / 3600), "h"] : [Math.round(sec / 86400), "d"];
    return (t("ago") ? t("ago") + " " : "") + u[0] + " " + t(u[1]);
  }

  // attributs affiches en premier sur une carte
  var MAIN_ATTRS = ["Power", "Dimmer", "Temperature", "Humidity", "Pressure", "Illuminance",
                    "Occupancy", "Contact", "Water", "Action", "Click", "BatteryPercentage"];
  function hasPower(d) { return Object.keys(d.attrs).some(function (k) { return /^Power\d*$/.test(k); }); }

  function viewDevices() {
    if (!state.devices) { append(main, h("p", null, t("loading"))); return; }
    var list = Object.keys(state.devices).map(function (k) { return state.devices[k]; });
    if (state.status && state.status.zigbee === false) { append(main, h("p", null, t("zigbeeOff"))); return; }
    var bar = h("div", { class: "row" },
      h("button", { class: "b", onclick: function () { cmd("ZbPermitJoin 1"); } }, t("pair")),
      h("button", { class: "b", onclick: loadDevices }, t("refresh")));
    append(main, bar);
    if (!list.length) { append(main, h("p", null, t("noDevice"))); return; }
    list.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    var grid = h("div", { class: "grid" });
    list.forEach(function (d) {
      var since = d.seenAt ? Math.round((Date.now() - d.seenAt) / 1000) : d.lastseen;
      var shown = MAIN_ATTRS.filter(function (k) { return d.attrs[k] != null; });
      append(grid, h("article", { class: "card" },
        h("h3", null, d.name || d.addr),
        h("div", { class: "q" }, [d.model, d.manufacturer].filter(Boolean).join(" · ") || d.addr),
        h("div", { class: "st" }, shown.map(function (k) {
          var v = d.attrs[k];
          return h("span", null, k + " ", h("b", null, typeof v === "object" ? JSON.stringify(v) : String(v)));
        })),
        h("div", { class: "q" },
          "LQI " + (d.lqi != null ? d.lqi : "?") + " · " + t("lastSeen") + " " + ago(since) +
          (d.battery != null ? " · " + t("battery") + " " + d.battery + " %" : "") +
          (d.reachable === false ? " · " + t("unreachable") : "") +
          " · " + (d.router ? t("router") : t("endDevice"))),
        hasPower(d) ? h("div", { class: "row", style: "margin:.5rem 0 0" },
          h("button", { class: "b", onclick: function () {
            cmd('ZbSend {"device":"' + d.addr + '","send":{"Power":"Toggle"}}');
          } }, t("toggle"))) : null));
    });
    append(main, grid);
  }

  function viewEvents() {
    if (!state.events.length) { append(main, h("p", null, t("noEvent"))); return; }
    append(main, h("ol", { class: "ev" }, state.events.map(function (ev) {
      var time = new Date(ev.ts * 1000).toLocaleTimeString(lang);
      return h("li", null, h("span", { class: "q" }, time + " · "), h("b", null, ev.name || ev.device || ev.type), " ",
               JSON.stringify(ev.attrs || ev));
    })));
  }

  var consoleOut = null;
  function viewConsole() {
    var input = h("input", { "aria-label": t("cmdPlaceholder"), placeholder: t("cmdPlaceholder") });
    var out = consoleOut || h("pre", null, "");
    consoleOut = out;
    function run() {
      var c = input.value.trim();
      if (!c) return;
      cmd(c).then(function (r) { out.textContent = "> " + c + "\n" + JSON.stringify(r, null, 2); })
        .catch(function (e) { out.textContent = "> " + c + "\n" + t("error") + " : " + e.message; });
    }
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") run(); });
    append(main, [h("div", { class: "row" }, input, h("button", { class: "b", onclick: run }, t("send"))), out]);
    input.focus();
  }

  function viewDiag() {
    var s = state.status;
    if (!s) { append(main, h("p", null, t("loading"))); return; }
    var mem = s.memory || {};
    append(main, [
      h("dl", null,
        h("dt", null, t("source")), h("dd", null, cfg.source + (cfg.source === "github" ? " (" + cfg.cdn + ")" : "")),
        h("dt", null, t("loadTime")), h("dd", null, Math.round(state.startMs) + " ms"),
        h("dt", null, t("heap")), h("dd", null, mem.heap_free != null ? mem.heap_free + " Ko" : "?"),
        h("dt", null, t("ufs")), h("dd", null, s.ufs_free_kb != null ? s.ufs_free_kb + " / " + s.ufs_size_kb + " Ko" : "?")),
      h("h3", null, "/api/status"),
      h("pre", null, JSON.stringify(s, null, 2))
    ]);
  }

  // ---------------------------------------------------------------- demarrage
  render();
  Promise.all([loadStatus(), loadDevices()]).then(function () {
    state.startMs = performance.now() - T0;
    connectEvents();
  });
})();
