// SPDX-License-Identifier: GPL-3.0-only
import { html } from './html.js';
import { t, L, toggleLang } from './i18n.js';
import { S, setTab, selectGateway } from './state.js';
import cfg from './config.js';

function Header() {
  const s = S.use();
  const { lang } = L.get();
  const name = s.status && s.status.device_name;
  return html`<header>
    <h1>TasmoFlow</h1>
    ${s.gws.length ? html`<select aria-label=${t('gateway')} value=${s.gw.id} onChange=${e => selectGateway(e.target.value)}>
      <option value="local">${t('thisGateway')}</option>
      ${s.gws.map(g => html`<option value=${g.id}>${g.name}</option>`)}
    </select>` : null}
    ${name ? html`<span class="gw">${name}</span>` : null}
    <span class="sp"></span>
    <span class=${'badge ' + (s.live ? 'ok' : 'bad')}>${s.live ? t('live') : t('reconnecting')}</span>
    <span class="badge">${'v' + cfg.version + ' · ' + cfg.source + (cfg.lite ? ' · lite' : '') + (__BUILD__ ? ' · ' + __BUILD__ : '')}</span>
    <button class="b" lang=${lang === 'fr' ? 'en' : 'fr'} aria-label=${lang === 'fr' ? 'English' : 'Français'} onClick=${toggleLang}>${lang === 'fr' ? 'EN' : 'FR'}</button>
  </header>`;
}

// tabs: { id: component }, in display order
// an extra banner, put in by the interface that wants one (the light one: update of the .tapp)
let Extra = null;
export const registerBanner = c => { Extra = c; };

export function createApp(tabs) {
  return function App() {
    const { tab, error } = S.use();
    L.use();
    const View = tabs[tab];
    return html`
      <${Header}/>
      <nav aria-label="TasmoFlow">${Object.keys(tabs).map(k => html`<button key=${k} aria-current=${tab === k ? 'page' : null} onClick=${() => setTab(k)}>${t(k)}</button>`)}</nav>
      <main aria-live="polite">
        ${Extra ? html`<${Extra}/>` : null}
        ${cfg.lite && !(cfg.update) ? html`<p class="lite" role="status">${t('liteBanner')} <button class="b" onClick=${() => location.reload()}>${t('retry')}</button></p>` : null}
        ${error ? html`<p class="badge bad">${t('error') + ' : ' + error}</p>` : null}
        <${View}/>
      </main>`;
  };
}
