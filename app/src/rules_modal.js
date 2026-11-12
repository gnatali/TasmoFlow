// SPDX-License-Identifier: GPL-3.0-only
// A dialog over the page (native <dialog>: Escape and the backdrop close it). Shared by the form of
// the sentence editor and the guided mode. `foot` replaces the default "Done" button.
import { useRef, useEffect } from 'preact/hooks';
import { html } from './html.js';
import { t } from './i18n.js';

export function Modal({ title, onClose, children, foot }) {
  const ref = useRef();
  useEffect(() => { if (ref.current && !ref.current.open) ref.current.showModal(); }, []);
  const close = () => ref.current && ref.current.close();
  return html`<dialog ref=${ref} class="modal" aria-label=${title} onClose=${onClose}
      onClick=${e => { if (e.target === ref.current) close(); }}>
    <div class="mhead"><h3>${title}</h3><button class="b" aria-label=${t('rule_closeBlock')} onClick=${close}>×</button></div>
    ${children}
    <div class="row tight mfoot">${foot || html`<button class="b primary" onClick=${close}>${t('rule_finish')}</button>`}</div>
  </dialog>`;
}
