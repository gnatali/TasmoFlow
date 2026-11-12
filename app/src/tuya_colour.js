// SPDX-License-Identifier: GPL-3.0-only
// Card panel of the Tuya `light2` and `light3` bindings, laid out like the Tuya app (full interface only: the light
// one keeps its size for device control and the update). Plugged into the cards through
// EXTRA.refine (tuya.js). `light3`: tabs White / Colour follow the device's mode DP; the white tab has the
// colour temperature arc (if the binding has `dp_ct`) and brightness, the colour tab a hue wheel and two
// sliders (brightness = value, saturation). `light2` (white only): colour temperature on an open arc dial
// (warm to cool) and brightness, a change leaves a scene or other mode for the white one.
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

// Generic dial (a hue wheel or the colour temperature arc). `at(e)` gives the value under the pointer (null:
// ignore), `pos(v)` the knob's [x, y] in %, `nudge(v, dir)` the value after an arrow key. The knob follows the
// pointer while it is down (local preview), the value is sent on release.
function Dial({ value, min, max, at, pos, nudge, cls, label, centre, disabled, onPick }) {
  const [drag, setDrag] = useState(null);
  const cur = useRef(null);                       // the latest value of a quick tap, before the next render
  const move = v => { cur.current = v; setDrag(v); };
  const shown = drag == null ? value : drag;
  const [x, y] = pos(shown);
  return html`<div class="wheel" role="slider" tabindex=${disabled ? -1 : 0} aria-label=${label} aria-valuemin=${min} aria-valuemax=${max}
    aria-valuenow=${shown} aria-disabled=${disabled}
    onPointerDown=${e => { if (disabled) return; const v = at(e); if (v != null) { e.currentTarget.setPointerCapture(e.pointerId); move(v); } }}
    onPointerMove=${e => { if (cur.current != null) { const v = at(e); if (v != null) move(v); } }}
    onPointerUp=${() => { const v = cur.current; cur.current = null; setDrag(null); if (v != null) onPick(v); }}
    onPointerCancel=${() => { cur.current = null; setDrag(null); }}
    onKeyDown=${e => {
      const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
      if (d && !disabled) { e.preventDefault(); onPick(nudge(shown, d)); }
    }}>
    <div class=${'ring ' + cls}></div>
    <div class="swatch" style=${'background:' + centre[0]}>${centre[1]}</div>
    <div class="knob" style=${`left:${x}%;top:${y}%`}></div>
  </div>`;
}

// position of a pointer relative to the dial's centre, or null in the centre (it only shows the value)
const rel = e => {
  const r = e.currentTarget.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  return Math.hypot(dx, dy) < r.width * 0.27 ? null : [dx, dy];
};

// hue wheel: hue 0 at 3 o'clock, counter-clockwise like the Tuya app; arrows move it by 5 degrees
function HueWheel({ hue, rgb, disabled, onPick }) {
  return html`<${Dial} value=${hue} min=${0} max=${360} cls="hue" label=${t('hue')} centre=${[rgb, '']} disabled=${disabled} onPick=${onPick}
    at=${e => { const d = rel(e); return d && (Math.round(Math.atan2(-d[1], d[0]) * 180 / Math.PI) + 360) % 360; }}
    pos=${h => [50 + 39.5 * Math.cos(h * Math.PI / 180), 50 - 39.5 * Math.sin(h * Math.PI / 180)]}
    nudge=${(h, d) => (h + 5 * d + 360) % 360}/>`;
}

// colour temperature arc, open at the bottom: 0 % (warm) at the bottom left, 50 % at the top, 100 % (cool)
// at the bottom right, 270 degrees in all (CSS angles, clockwise from 12 o'clock, start at 225)
export function arcValue(dx, dy) {
  let r = ((Math.atan2(dx, -dy) * 180 / Math.PI - 225) % 360 + 360) % 360;
  if (r > 270) r = r > 315 ? 0 : 270;               // in the gap: the nearer end
  return Math.round(r / 270 * 100);
}
// swatch colour of a temperature: warm, white, cool (the arc's own gradient)
const ctColour = p => {
  const [a, b, f] = p < 50 ? [[255, 154, 46], [241, 241, 241], p / 50] : [[241, 241, 241], [111, 176, 255], (p - 50) / 50];
  return 'rgb(' + a.map((x, i) => Math.round(x + (b[i] - x) * f)) + ')';
};
function ArcDial({ raw, disabled, onPick }) {
  const pct = raw == null ? 0 : clamp(raw / 10, 0, 100);
  return html`<${Dial} value=${pct} min=${0} max=${100} cls="arc" label=${t('colortemp')} disabled=${disabled} onPick=${v => onPick(v * 10)}
    centre=${[ctColour(pct), raw == null ? '?' : pct + ' %']}
    at=${e => { const d = rel(e); return d && arcValue(d[0], d[1]); }}
    pos=${v => { const a = (225 + 2.7 * v) * Math.PI / 180; return [50 + 39.5 * Math.sin(a), 50 - 39.5 * Math.cos(a)]; }}
    nudge=${(v, d) => clamp(v + 5 * d, 0, 100)}/>`;
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
      ${c.ctDp ? html`<${ArcDial} raw=${node.dps[c.ctDp]} disabled=${off} onPick=${v => setWhite(c.ctDp, v)}/>` : null}
      <${Range} label=${t('brightness')} raw=${node.dps[c.briDp]} lo=${c.bmin} hi=${c.bmax} disabled=${off}
        onSend=${v => setWhite(c.briDp, v)}/>`}
  </div>`;
}

EXTRA.refine = lightControls;
