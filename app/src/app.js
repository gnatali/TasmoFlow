// SPDX-License-Identifier: GPL-3.0-only
import { html } from './html.js';
import { t, L, toggleLang } from './i18n.js';
import { S, setTab, selectGateway } from './state.js';
import cfg from './config.js';
import { DevicesView, EventsView, ConsoleView, DiagView } from './views.js';
import { GatewaysView } from './gateways.js';

const TABS = { devices: DevicesView, events: EventsView, console: ConsoleView, gateways: GatewaysView, diag: DiagView };

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
    <span class="badge">${'v' + cfg.version + ' · ' + cfg.source}</span>
    <button class="b" lang=${lang === 'fr' ? 'en' : 'fr'} aria-label=${lang === 'fr' ? 'English' : 'Français'} onClick=${toggleLang}>${lang === 'fr' ? 'EN' : 'FR'}</button>
  </header>`;
}

export function App() {
  const { tab, error } = S.use();
  L.use();
  const View = TABS[tab];
  return html`
    <${Header}/>
    <nav aria-label="TasmoFlow">${Object.keys(TABS).map(k => html`<button key=${k} aria-current=${tab === k ? 'page' : null} onClick=${() => setTab(k)}>${t(k)}</button>`)}</nav>
    <main aria-live="polite">
      ${error ? html`<p class="badge bad">${t('error') + ' : ' + error}</p>` : null}
      <${View}/>
    </main>`;
}
