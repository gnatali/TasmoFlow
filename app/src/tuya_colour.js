// SPDX-License-Identifier: GPL-3.0-only
// Card panel of the Tuya `light2` and `light3` bindings, laid out like the Tuya app (full interface only: the light
// one keeps its size for device control and the update). Plugged into the cards through
// EXTRA.refine (tuya.js). `light3`: tabs White / Colour follow the device's mode DP; the white tab has the
// brightness (and a colour temperature if the binding has `dp_ct`), the colour tab a hue wheel and two
// sliders (brightness = value, saturation). `light2` (white only): brightness and colour temperature
// (warm to cool), a change leaves a scene or other mode for the white one.
import { useState, useRef } from 'preact/hooks';
import { html } from './html.js';
import { t } from './i18n.js';
import { EXTRA } from './tuya.js';

// Tuya colour_data_v2: `hhhhssssvvvv` in hexadecimal, hue 0..360, saturation and value 0..1000.
// { h, s, v } of such a string, or null
export function parseColour(s) {
  if (typeof s !== 'string' || !/^[0-9a-f]{12}$/i.test(s)) return null;
  return { h: Math.min(360, parseInt(s.slice(0, 4), 16)), s: Math.min(1000, parseInt(s.slice(4, 8), 16)), v: Math.min(1000, parseInt(s.slice(8), 16)) };
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Math.round(x)));

export function formatColour(h, s, v) {
  return [clamp(h, 0, 360), clamp(s, 0, 1000), clamp(v, 0, 1000)].map(x => x.toString(16).padStart(4, '0')).join('');
}

// '#rrggbb' of a colour { h, s, v }
export function colourToRgb({ h, s, v }) {
  const sat = s / 1000, val = v / 1000;
  const f = n => { const k = (n + h / 60) % 6; return val - val * sat * Math.max(0, Math.min(k, 4 - k, 1)); };
  return '#' + [f(5), f(3), f(1)].map(x => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('');
}

// Colour value of the colour tab: the driver's own range (bri_to_raw(.., 10, 1000))
const V_MIN = 10, V_MAX = 1000;

// The bindings of type light2 and light3 of a device give one panel each; it replaces the shared
// controls of the binding (brightness, and colour temperature of a light2), now inside the panel.
export function lightControls(controls, entry) {
  const out = controls.slice();
  for (const b of (entry && entry.matter) || []) {
    const white = b.type === 'light2';
    if (!white && b.type !== 'light3') continue;
    const dpOf = (k, d) => String(b[k] != null ? b[k] : d);
    const briDp = dpOf('dp_bri', 22), ctDp = white ? dpOf('dp_ct', 23) : b.dp_ct != null ? String(b.dp_ct) : null;
    for (const dp of [briDp, white ? ctDp : null]) {
      const i = out.findIndex(c => c.kind === 'range' && c.dp === dp && c.percent);
      if (i >= 0) out.splice(i, 1);
    }
    out.push({ kind: 'light', render: LightPanel, colour: !white, dp: dpOf('dp_colour', 24), modeDp: dpOf('dp_mode', 21),
      briDp, bmin: b.bri_min != null ? +b.bri_min : 10, bmax: b.bri_max != null ? +b.bri_max : 1000, ctDp });
  }
  return out;
}

// slider in % of a raw range, the command goes out when it is released
function Range({ label, raw, lo, hi, disabled, onSend, cls }) {
  const low = lo ? 1 : 0;                         // a brightness (raw 10..1000) goes 1-100 % like the Tuya app, never 0
  const pct = raw == null ? low : clamp(low + (raw - lo) / (hi - lo) * (100 - low), low, 100);
  return html`<label class="rng">${label + (raw == null ? ' ?' : '') + ' '}<input type="range" class=${cls} min=${low} max="100" value=${pct}
    disabled=${disabled} aria-label=${label} onChange=${e => onSend(Math.round(lo + (+e.target.value - low) / (100 - low) * (hi - lo)))}/>
    <span class="q">${pct + ' %'}</span></label>`;
}

// hue wheel: hue 0 at 3 o'clock, counter-clockwise like the Tuya app. The knob follows the pointer
// while it is down (local preview), the colour is sent on release; arrows move it by 5 degrees
function HueWheel({ hue, rgb, disabled, onPick }) {
  const [drag, setDrag] = useState(null);
  const cur = useRef(null);                       // the latest hue of a quick tap, before the next render
  const move = h => { cur.current = h; setDrag(h); };
  const shown = drag == null ? hue : drag;
  const at = e => {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width * 0.27) return null;           // the centre only shows the colour
    return (Math.round(Math.atan2(-dy, dx) * 180 / Math.PI) + 360) % 360;
  };
  const a = shown * Math.PI / 180;
  return html`<div class="wheel" role="slider" tabindex=${disabled ? -1 : 0} aria-label=${t('hue')} aria-valuemin="0" aria-valuemax="360"
    aria-valuenow=${shown} aria-disabled=${disabled}
    onPointerDown=${e => { if (disabled) return; const h = at(e); if (h != null) { e.currentTarget.setPointerCapture(e.pointerId); move(h); } }}
    onPointerMove=${e => { if (cur.current != null) { const h = at(e); if (h != null) move(h); } }}
    onPointerUp=${() => { const h = cur.current; cur.current = null; setDrag(null); if (h != null) onPick(h); }}
    onPointerCancel=${() => { cur.current = null; setDrag(null); }}
    onKeyDown=${e => {
      const d = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5 }[e.key];
      if (d && !disabled) { e.preventDefault(); onPick((shown + d + 360) % 360); }
    }}>
    <div class="ring"></div>
    <div class="swatch" style=${'background:' + rgb}></div>
    <div class="knob" style=${`left:${50 + 39.5 * Math.cos(a)}%;top:${50 - 39.5 * Math.sin(a)}%`}></div>
  </div>`;
}

function LightPanel({ c, node, send }) {
  const mode = node.dps[c.modeDp];
  const colour = parseColour(node.dps[c.dp]) || { h: 0, s: 1000, v: 1000 };   // the driver's default
  const off = !node.connected;
  // the wanted mode first (when the device reports a mode DP and is not in it), then the value
  const inMode = (m, go) => mode === undefined || mode === m ? go() : send(c.modeDp, m).then(go);
  // the whole colour as a JSON string (a value of digits only would be read as a number)
  const setColour = patch => {
    const n = Object.assign({}, colour, patch);
    return inMode('colour', () => send(c.dp, '"' + formatColour(n.h, n.s, n.v) + '"'));
  };
  const setWhite = (dp, v) => inMode('white', () => send(dp, v));
  return html`<div class="l3">
    ${c.colour ? html`<div class="tabs" role="tablist">${['white', 'colour'].map(m => html`<button role="tab" aria-selected=${mode === m}
      disabled=${off} onClick=${() => send(c.modeDp, m)}>${t(m)}</button>`)}</div>` : null}
    ${mode === 'colour' && c.colour ? html`
      <${HueWheel} hue=${colour.h} rgb=${colourToRgb(colour)} disabled=${off} onPick=${h => setColour({ h })}/>
      <${Range} label=${t('brightness')} raw=${node.dps[c.dp] == null ? null : colour.v} lo=${V_MIN} hi=${V_MAX} disabled=${off}
        onSend=${v => setColour({ v })}/>
      <${Range} label=${t('saturation')} raw=${node.dps[c.dp] == null ? null : colour.s} lo=${0} hi=${1000} disabled=${off}
        onSend=${s => setColour({ s })}/>` : html`
      <${Range} label=${t('brightness')} raw=${node.dps[c.briDp]} lo=${c.bmin} hi=${c.bmax} disabled=${off}
        onSend=${v => setWhite(c.briDp, v)}/>
      ${c.ctDp ? html`<${Range} cls="ct" label=${t('colortemp')} raw=${node.dps[c.ctDp]} lo=${0} hi=${1000} disabled=${off}
        onSend=${v => setWhite(c.ctDp, v)}/>` : null}`}
  </div>`;
}

EXTRA.refine = lightControls;
