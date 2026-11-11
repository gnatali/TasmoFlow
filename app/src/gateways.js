// SPDX-License-Identifier: GPL-3.0-only
// Gateways screen: link to use this gateway from another interface, list of the others, and the
// gateway picker of the header. Full interface only (main.js).
import { useState } from 'preact/hooks';
import { html } from './html.js';
import { t } from './i18n.js';
import { S, reach, selectGateway } from './state.js';
import { loadRemotes, saveRemotes, parseLink, makeLink } from './remotes.js';
import cfg from './config.js';

// the other gateways saved in this browser, read once before the interface starts
export const initGateways = () => S.set({ gws: loadRemotes() });

function addRemote(gw) {
  const gws = [...S.get().gws, gw];
  saveRemotes(gws);
  S.set({ gws });
}

function removeRemote(id) {
  const gws = S.get().gws.filter(g => g.id !== id);
  saveRemotes(gws);
  if (S.get().gw.id === id) selectGateway('local');
  S.set({ gws });
}

// in the header, once another gateway is saved
export function GatewayPicker() {
  const s = S.get();
  return s.gws.length ? html`<select aria-label=${t('gateway')} value=${s.gw.id} onChange=${e => selectGateway(e.target.value)}>
    <option value="local">${t('thisGateway')}</option>
    ${s.gws.map(g => html`<option value=${g.id}>${g.name}</option>`)}
  </select>` : null;
}

// Clipboard API needs a secure context, which http://<gateway> is not: fall back to execCommand
function copyText(text, input) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  input.select();
  return document.execCommand('copy') ? Promise.resolve() : Promise.reject(new Error('copy'));
}

function ThisGateway() {
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(false);
  const full = makeLink(location.hostname, cfg.port, cfg.token);
  const masked = makeLink(location.hostname, cfg.port, '•'.repeat(32));
  let box;
  return html`
    <h2>${t('thisGateway')}</h2>
    <p class="q">${t('thisGatewayHelp')}</p>
    <div class="row">
      <input readonly ref=${el => { box = el; }} aria-label=${t('link')} class="link"
        value=${shown ? full : masked} onFocus=${e => shown && e.target.select()}/>
      <button class="b" onClick=${() => setShown(!shown)}>${shown ? t('hide') : t('show')}</button>
      <button class="b" onClick=${() => {
        setShown(true);
        setTimeout(() => copyText(full, box).then(() => { setDone(true); setTimeout(() => setDone(false), 2000); }).catch(() => {}), 0);
      }}>${done ? t('copied') : t('copy')}</button>
    </div>`;
}

function Remote({ g, isCurrent }) {
  const [msg, setMsg] = useState(null);       // { ok, text }
  const test = () => {
    setMsg({ ok: true, text: '…' });
    reach(g, () => setMsg({ ok: true, text: t('waking') })).then(s => {
      const heap = s.memory && s.memory.heap_free;
      setMsg({ ok: true, text: [t('ok'), s.device_name, 'v' + s.tasmoflow, heap != null ? t('memory') + ' ' + heap + ' Ko' : null]
        .filter(Boolean).join(' · ') });
    }).catch(e => setMsg({ ok: false, text: t('error') + ' : ' + e.message }));
  };
  return html`<article class="card">
    <h3>${g.name}</h3>
    <div class="q">${g.api}</div>
    <div class="row tight">
      <button class="b" disabled=${isCurrent} onClick=${() => selectGateway(g.id)}>${t('use')}</button>
      <button class="b" onClick=${test}>${t('test')}</button>
      <button class="b" onClick=${() => confirm(t('confirmRemove')) && removeRemote(g.id)}>${t('remove')}</button>
    </div>
    ${msg ? html`<div class=${'msg ' + (msg.ok ? 'ok' : 'bad')} role="status">${msg.text}</div>` : null}
  </article>`;
}

function AddForm() {
  const { gws } = S.get();
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [err, setErr] = useState(null);
  const submit = e => {
    e.preventDefault();
    const p = parseLink(link);
    if (!p) return setErr(t('invalidLink'));
    if (p.token === cfg.token || S.get().gws.some(g => g.api === p.api && g.token === p.token)) return setErr(t('duplicate'));
    addRemote({ id: 'g' + Date.now().toString(36), name: name.trim() || new URL(p.api).hostname, ...p });
    setName(''); setLink(''); setErr(null);
  };
  return html`
    <h2>${t('add')}</h2>
    <form class="row" onSubmit=${submit}>
      <input value=${name} placeholder=${t('name')} aria-label=${t('name')} style="max-width:14rem" onInput=${e => setName(e.target.value)}/>
      <input value=${link} placeholder=${t('pasteLink')} aria-label=${t('link')} class="link" onInput=${e => setLink(e.target.value)}/>
      <button class="b" type="submit">${t('add')}</button>
    </form>
    ${err ? html`<p class="msg bad" role="alert">${err}</p>` : null}`;
}

export function GatewaysView() {
  const { gws, gw } = S.get();
  return html`
    <${ThisGateway}/>
    <h2>${t('others')}</h2>
    ${gws.length ? html`<div class="grid">${gws.map(g => html`<${Remote} key=${g.id} g=${g} isCurrent=${gw === g}/>`)}</div>` : html`<p class="q">${t('noOthers')}</p>`}
    <${AddForm}/>`;
}

