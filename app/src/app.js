// SPDX-License-Identifier: GPL-3.0-only
import { html } from './html.js';
import { t, L, toggleLang } from './i18n.js';
import { S, setTab } from './state.js';
import cfg from './config.js';

// Picker: the gateway picker, in the full interface only (gateways.js)
function Header({ Picker }) {
  const s = S.get();
  const { lang } = L.get();
  const name = s.status && s.status.device_name;
  return html`<header>
    <h1>TasmoFlow</h1>
    ${Picker ? html`<${Picker}/>` : null}
    ${name ? html`<span class="gw">${name}</span>` : null}
    <span class="sp"></span>
    <span class=${'badge ' + (s.live ? 'ok' : 'bad')}>${s.live ? t('live') : t('reconnecting')}</span>
    <span class="badge">${'v' + cfg.version + ' · ' + cfg.source + (cfg.lite ? ' · lite' : '') + (__BUILD__ ? ' · ' + __BUILD__ : '')}</span>
    <button class="b" lang=${lang === 'fr' ? 'en' : 'fr'} aria-label=${lang === 'fr' ? 'English' : 'Français'} onClick=${toggleLang}>${lang === 'fr' ? 'EN' : 'FR'}</button>
  </header>`;
}

// tabs: { id: component }, in display order (no tab bar for a single one: the light interface)
// Banner: an extra banner (the light interface: update of the .tapp); Picker: see Header
export function createApp(tabs, { Banner, Picker } = {}) {
  const ids = Object.keys(tabs);
  return function App() {
    const { tab, error } = S.get();
    const View = tabs[tab] || tabs[ids[0]];
    return html`
      <${Header} Picker=${Picker}/>
      ${ids.length > 1 ? html`<nav aria-label="TasmoFlow">${ids.map(k => html`<button key=${k} aria-current=${tab === k ? 'page' : null} onClick=${() => setTab(k)}>${t(k)}</button>`)}</nav>` : null}
      <main aria-live="polite">
        ${Banner ? html`<${Banner}/>` : null}
        ${cfg.lite && !(cfg.update) ? html`<p class="lite" role="status">${t('liteBanner')} <button class="b" onClick=${() => location.reload()}>${t('retry')}</button></p>` : null}
        ${error ? html`<p class="badge bad">${t('error') + ' : ' + error}</p>` : null}
        <${View}/>
      </main>`;
  };
}
