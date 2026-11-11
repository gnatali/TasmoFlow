// SPDX-License-Identifier: GPL-3.0-only
// TasmoFlow, light interface: the copy kept in the .tapp, served by the gateway when GitHub Pages
// cannot be reached (no internet access for the browser, GitHub down, wrong SRI hash) or when an
// update of the .tapp is offered. Device control and the update only: everything else (rules,
// events, console, gateways, diagnostics) is in the full interface. Same sources as main.js.
import { boot } from './boot.js';
import { DevicesView } from './views.js';
import { UpdateBanner } from './update.js';

boot({ devices: DevicesView }, { lite: true, Banner: UpdateBanner });
