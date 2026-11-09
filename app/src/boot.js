// SPDX-License-Identifier: GPL-3.0-only
// Starts an interface: `tabs` ({ id: component }) says what it offers. The full interface
// (main.js, GitHub Pages) and the light one (main_lite.js, the .tapp's local copy) share all
// the code and only differ by their tabs.
import { render } from 'preact';
import { html } from './html.js';
import cfg from './config.js';
import { t } from './i18n.js';
import { createApp } from './app.js';
import { init } from './state.js';
import css from './style.css';

export function boot(tabs, lite) {
  if (window.TASMOFLOW_STARTED) return;       // the GitHub copy and the local copy may both arrive
  window.TASMOFLOW_STARTED = true;
  // actual origin: the GitHub copy may arrive after the timeout, and the local copy before it
  const me = document.currentScript && document.currentScript.src;
  if (cfg.api && me) cfg.source = me.indexOf(cfg.api) === 0 ? 'local' : 'github';
  cfg.lite = !!lite;
  const root = document.getElementById('tasmoflow') || document.body;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  root.textContent = '';
  root.removeAttribute('style');
  if (!cfg.api || !cfg.token) {
    render(html`<main><p>${t('noConfig')}</p></main>`, root);
  } else {
    const App = createApp(tabs);
    render(html`<${App}/>`, root);
    init();
  }
}
