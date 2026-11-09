// SPDX-License-Identifier: GPL-3.0-only
// TasmoFlow, no-code web interface for a Tasmota Zigbee gateway.
// Loaded by the gateway's /tf page, which provides window.TASMOFLOW (see config.js).
import { render } from 'preact';
import { html } from './html.js';
import cfg from './config.js';
import { t } from './i18n.js';
import { App } from './app.js';
import { init } from './state.js';
import css from './style.css';

if (!window.TASMOFLOW_STARTED) {          // the GitHub copy and the local copy may both arrive
  window.TASMOFLOW_STARTED = true;
  // actual origin: the GitHub copy may arrive after the timeout, and the local copy before it
  const me = document.currentScript && document.currentScript.src;
  if (cfg.api && me) cfg.source = me.indexOf(cfg.api) === 0 ? 'local' : 'github';
  const root = document.getElementById('tasmoflow') || document.body;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  root.textContent = '';
  root.removeAttribute('style');
  if (!cfg.api || !cfg.token) {
    render(html`<main><p>${t('noConfig')}</p></main>`, root);
  } else {
    render(html`<${App}/>`, root);
    init();
  }
}
