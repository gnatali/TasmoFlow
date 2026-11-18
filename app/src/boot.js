// SPDX-License-Identifier: GPL-3.0-only
// Starts the interface: `tabs` ({ id: component }) says what it offers.
// opts: { css (more styles), Banner, Picker (see app.js) }
import { render } from 'preact';
import { html } from './html.js';
import cfg from './config.js';
import { t } from './i18n.js';
import { createApp } from './app.js';
import { init } from './state.js';
import { onChange } from './store.js';
import css from './style.css';

export function boot(tabs, opts) {
  if (window.TASMOFLOW_STARTED) return;       // never twice in one page
  window.TASMOFLOW_STARTED = true;
  // where it came from: the gateway's local copy, or GitHub Pages
  const me = document.currentScript && document.currentScript.src;
  if (cfg.api && me) cfg.source = me.indexOf(cfg.api) === 0 ? 'local' : 'github';
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
