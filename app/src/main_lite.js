// SPDX-License-Identifier: GPL-3.0-only
// TasmoFlow, light interface: the copy kept in the .tapp, used when GitHub Pages cannot be
// reached (no internet access for the browser, GitHub down, wrong SRI hash). Devices, console
// and diagnostics only: the rest needs the full interface. Same code as main.js, fewer tabs.
import { boot } from './boot.js';
import { DevicesView, ConsoleView, DiagView } from './views.js';

boot({ devices: DevicesView, console: ConsoleView, diag: DiagView }, true);
