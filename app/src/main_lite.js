// SPDX-License-Identifier: GPL-3.0-only
// TasmoFlow, light interface: the copy kept in the .tapp, used when GitHub Pages cannot be
// reached (no internet access for the browser, GitHub down, wrong SRI hash). Devices, rules (enable,
// disable, restore), console and diagnostics only: the rest needs the full interface. Same code as main.js, fewer tabs.
import { boot } from './boot.js';
import { DevicesView, ConsoleView, DiagView } from './views.js';
import { RulesView } from './rules.js';

boot({ devices: DevicesView, rules: RulesView, console: ConsoleView, diag: DiagView }, true);
