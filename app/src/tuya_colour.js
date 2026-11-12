// SPDX-License-Identifier: GPL-3.0-only
// Colour of the Tuya `light3` bindings (full interface only: the light one keeps its size for
// device control and the update). Added to the cards through EXTRA.more (tuya.js).
import { html } from './html.js';
import { t } from './i18n.js';
import { EXTRA } from './tuya.js';

// Tuya colour_data_v2: `hhhhssssvvvv` in hexadecimal, hue 0..360, saturation and value 0..1000.
// '#rrggbb' of such a string, or null
export function colourToRgb(s) {
  if (typeof s !== 'string' || !/^[0-9a-f]{12}$/i.test(s)) return null;
  const h = parseInt(s.slice(0, 4), 16) % 360, sat = parseInt(s.slice(4, 8), 16) / 1000, v = parseInt(s.slice(8), 16) / 1000;
  const f = n => { const k = (n + h / 60) % 6; return v - v * sat * Math.max(0, Math.min(k, 4 - k, 1)); };
  return '#' + [f(5), f(3), f(1)].map(x => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('');
}

// the string of a '#rrggbb' colour
export function rgbToColour(rgb) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(rgb.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(h * 60) % 360, Math.round(max ? d / max * 1000 : 0), Math.round(max * 1000)]
    .map(x => x.toString(16).padStart(4, '0')).join('');
}

// the colour pickers of a device: one per `light3` binding (colour on `dp_colour`, mode on `dp_mode`)
export function colourControls(entry) {
  const out = [];
  for (const b of (entry && entry.matter) || []) {
    if (b.type === 'light3') {
      out.push({ kind: 'colour', render: ColourControl, label: t('colour'),
        dp: String(b.dp_colour != null ? b.dp_colour : 24), modeDp: String(b.dp_mode != null ? b.dp_mode : 21) });
    }
  }
  return out;
}

function ColourControl({ c, node, send }) {
  const v = node.dps[c.dp];
  // colour mode first (when the device reports a mode DP), then the colour as a JSON string
  // (a value of digits only would be read as a number)
  const pick = e => {
    const col = '"' + rgbToColour(e.target.value) + '"';
    return (node.dps[c.modeDp] === undefined ? Promise.resolve() : send(c.modeDp, 'colour')).then(() => send(c.dp, col));
  };
  return html`<label class="rng">${c.label + (v == null ? ' ?' : '') + ' '}<input type="color" value=${colourToRgb(v) || '#ffffff'}
    disabled=${!node.connected} aria-label=${c.label} onChange=${pick}/></label>`;
}

EXTRA.more = colourControls;
