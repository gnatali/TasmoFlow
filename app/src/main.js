// SPDX-License-Identifier: GPL-3.0-only
// TasmoFlow, no-code web interface for a Tasmota Zigbee gateway: the full interface, published
// on GitHub Pages (pinned version, SRI hash). Loaded by the gateway's /tf page, which
// provides window.TASMOFLOW (see config.js).
import { boot } from './boot.js';
import { addTexts } from './i18n.js';
import { FULL_TEXTS } from './i18n_full.js';
import css from './style_full.css';
import { onTab, loadStatus } from './state.js';
import { DevicesView } from './views.js';
import { EventsView, ConsoleView, DiagView } from './views_full.js';
import { RulesView, registerEditor, loadRules } from './rules.js';
import { SentenceEditor } from './rules_editor.js';
import { ConflictBanner } from './rules_conflicts_view.js';
import { findConflicts } from './rules_conflicts.js';
import { watchDrivers } from './drivers_full.js';
import './tuya_colour.js';
import { GatewaysView, GatewayPicker, initGateways } from './gateways.js';

addTexts(FULL_TEXTS);
registerEditor(SentenceEditor, ConflictBanner, findConflicts);
onTab({ diag: loadStatus, rules: loadRules });
initGateways();
watchDrivers();
boot({ devices: DevicesView, rules: RulesView, events: EventsView, console: ConsoleView, gateways: GatewaysView, diag: DiagView },
  { css, Picker: GatewayPicker });
