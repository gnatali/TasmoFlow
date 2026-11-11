// SPDX-License-Identifier: GPL-3.0-only
// TasmoFlow, no-code web interface for a Tasmota Zigbee gateway: the full interface, published
// on GitHub Pages (pinned version, SRI hash). Loaded by the gateway's /tf page, which
// provides window.TASMOFLOW (see config.js).
import { boot } from './boot.js';
import { DevicesView, EventsView, ConsoleView, DiagView } from './views.js';
import { RulesView, registerEditor } from './rules.js';
import { SentenceEditor } from './rules_editor.js';
import { ConflictBanner } from './rules_conflicts_view.js';
import { findConflicts } from './rules_conflicts.js';
import { GatewaysView } from './gateways.js';

registerEditor(SentenceEditor, ConflictBanner, findConflicts);
boot({ devices: DevicesView, rules: RulesView, events: EventsView, console: ConsoleView, gateways: GatewaysView, diag: DiagView }, false);
