// SPDX-License-Identifier: GPL-3.0-only
// Events, console and diagnostics screens: full interface only (main.js).
import { useState, useEffect, useRef } from 'preact/hooks';
import { html } from './html.js';
import { t, L } from './i18n.js';
import { S, cmd } from './state.js';
import cfg from './config.js';

export function EventsView() {
  const { events } = S.get();
  if (!events.length) return html`<p>${t('noEvent')}</p>`;
  const lang = L.get().lang;
  return html`<ol class="ev">${events.map(ev => html`<li key=${ev.seq}>
    <span class="q">${new Date(ev.ts * 1000).toLocaleTimeString(lang)} · </span><b>${ev.name || ev.device || ev.type}</b> ${JSON.stringify(ev.attrs || ev.dps || ev)}
  </li>`)}</ol>`;
}

export function ConsoleView() {
  const { consoleOut } = S.get();
  const [text, setText] = useState('');
  const input = useRef();
  useEffect(() => { input.current.focus(); }, []);
  const run = () => {
    const c = text.trim();
    if (!c) return;
    cmd(c).then(r => S.set({ consoleOut: '> ' + c + '\n' + JSON.stringify(r, null, 2) }))
      .catch(e => S.set({ consoleOut: '> ' + c + '\n' + t('error') + ' : ' + e.message }));
  };
  return html`
    <div class="row">
      <input ref=${input} value=${text} aria-label=${t('cmdPlaceholder')} placeholder=${t('cmdPlaceholder')}
        onInput=${e => setText(e.target.value)} onKeyDown=${e => e.key === 'Enter' && run()}/>
      <button class="b" onClick=${run}>${t('send')}</button>
    </div>
    <pre>${consoleOut}</pre>`;
}

export function DiagView() {
  const s = S.get();
  const st = s.status;
  if (!st) return html`<p>${t('loading')}</p>`;
  const mem = st.memory || {};
  return html`
    <dl>
      <dt>${t('gateway')}</dt><dd>${s.gw.api}</dd>
      <dt>${t('source')}</dt><dd>${cfg.source + (cfg.source === 'github' ? ' (' + cfg.cdn + ')' : '')}</dd>
      <dt>${t('loadTime')}</dt><dd>${Math.round(s.startMs)} ms</dd>
      <dt>${t('heap')}</dt><dd>${mem.heap_free != null ? mem.heap_free + ' Ko' : '?'}</dd>
      <dt>${t('ufs')}</dt><dd>${st.ufs_free_kb != null ? st.ufs_free_kb + ' / ' + st.ufs_size_kb + ' Ko' : '?'}</dd>
    </dl>
    <h3>/api/status</h3>
    <pre>${JSON.stringify(st, null, 2)}</pre>`;
}
