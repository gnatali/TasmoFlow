// SPDX-License-Identifier: GPL-3.0-only
// Starts an interface: `tabs` ({ id: component }) says what it offers. The full interface
// (main.js, GitHub Pages) and the light one (main_lite.js, the .tapp's local copy) share this
// code; the full one adds its screens, texts and styles, which the light bundle does not carry.
// opts: { lite, css (more styles), Banner, Picker (see app.js) }
import { render } from 'preact';
import { html } from './html.js';
import cfg from './config.js';
import { t } from './i18n.js';
import { createApp } from './app.js';
import { init } from './state.js';
import { onChange } from './store.js';
import css from './style.css';

export function boot(tabs, opts) {
  if (window.TASMOFLOW_STARTED) return;       // the GitHub copy and the local copy may both arrive
  window.TASMOFLOW_STARTED = true;
  // actual origin: the GitHub copy may arrive after the timeout, and the local copy before it
  const me = document.currentScript && document.currentScript.src;
  if (cfg.api && me) cfg.source = me.indexOf(cfg.api) === 0 ? 'local' : 'github';
  cfg.lite = !!opts.lite;
  const root = document.getElementById('tasmoflow') || document.body;
  const style = document.createElement('style');
  style.textContent = css + (opts.css || '');
  document.head.appendChild(style);
  root.textContent = '';
  root.removeAttribute('style');
  if (!cfg.api || !cfg.token) {
    render(html`<main><p>${t('noConfig')}</p></main>`, root);
  } else {
    // one render for all the set() calls of the same task (an event updates several things)
    const App = createApp(tabs, opts);
    let queued = false;
    const draw = () => { queued = false; render(html`<${App}/>`, root); };
    onChange(() => { if (!queued) { queued = true; Promise.resolve().then(draw); } });
    draw();
    init();
  }
}
