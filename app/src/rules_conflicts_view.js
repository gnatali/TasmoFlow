// SPDX-License-Identifier: GPL-3.0-only
// The list of rules that may clash, above the rule sets of the full interface (see rules_conflicts.js)
import { html } from './html.js';
import { t } from './i18n.js';
import { S } from './state.js';
import { findConflicts } from './rules_conflicts.js';
import { describeSubject, describeCommand } from './rules_devices.js';

const KIND = { cancel: 'rule_cCancel', contradict: 'rule_cContradict', duplicate: 'rule_cDuplicate' };

// the list above the rule sets of the full interface
export function ConflictBanner({ rules }) {
  const s = S.get();
  const list = findConflicts(rules);
  if (!list.length) return null;
  return html`<div class="conflicts" role="status"><b>${t('rule_conflicts') + ' (' + list.length + ')'}</b>
    <ul>${list.map(c => {
      const trig = (describeSubject(c.subject, s.devices, s.zbNames) || c.subject) + (c.op ? ' ' + c.op + ' ' + c.value : '');
      const act = describeCommand(c.cmd, s.devices, { On: t('rule_vOn'), Off: t('rule_vOff'), Toggle: t('rule_vToggle') }, s.tuya) || c.cmd;
      return html`<li><code>${trig}</code> → <code>${act.replace(/^\S+ /, '')}</code> : ${t(KIND[c.kind])}
        <span class="q">(${c.where.map(w => 'Rule' + w.n + ' · ' + t('rule_tile') + ' ' + (w.i + 1)).join(', ')})</span></li>`;
    })}</ul></div>`;
}
