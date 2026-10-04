// The weather controller on the left: pick where in the world the office is (its sun, clock and live
// forecast), set the weather and its strength by hand, or scrub the time of day. It is only for you:
// nobody else's sky changes (the shared one comes from server/sky.ts).
import * as THREE from 'three';
import type { Weather, SkyState } from '../../../shared/protocol';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { h } from '../../ui/dom';

interface Place {
  name: string;
  lat: number;
  lon: number;
  /** Standard time, minutes east of UTC: the forecast's own offset replaces it when it comes through. */
  utc: number;
}

const PLACES: Place[] = [
  { name: 'Vancouver, BC', lat: 49.2827, lon: -123.1207, utc: -480 },
  { name: 'Dubai', lat: 25.2048, lon: 55.2708, utc: 240 },
  { name: 'London', lat: 51.5072, lon: -0.1276, utc: 0 },
  { name: 'New York', lat: 40.7128, lon: -74.006, utc: -300 },
  { name: 'San Francisco', lat: 37.7749, lon: -122.4194, utc: -480 },
  { name: 'Reykjavik', lat: 64.1466, lon: -21.9426, utc: 0 },
  { name: 'Cairo', lat: 30.0444, lon: 31.2357, utc: 120 },
  { name: 'Mecca', lat: 21.3891, lon: 39.8579, utc: 180 },
  { name: 'Mumbai', lat: 19.076, lon: 72.8777, utc: 330 },
  { name: 'Singapore', lat: 1.3521, lon: 103.8198, utc: 480 },
  { name: 'Tokyo', lat: 35.6762, lon: 139.6503, utc: 540 },
  { name: 'Sydney', lat: -33.8688, lon: 151.2093, utc: 600 },
  { name: 'Auckland', lat: -36.8485, lon: 174.7633, utc: 720 },
  { name: 'Tromsø, Norway', lat: 69.6492, lon: 18.9553, utc: 60 },
];

const WEATHER: [Weather, string][] = [['clear', '☀️'], ['cloudy', '⛅'], ['rain', '🌧️'], ['storm', '⛈️'], ['snow', '❄️'], ['fog', '🌫️']];

/** open-meteo's WMO codes as our weather and how hard it is. */
function fromWmo(code: number): [Weather, number] {
  if (code <= 1) return ['clear', 0];
  if (code === 2) return ['cloudy', 0.4];
  if (code === 3) return ['cloudy', 1];
  if (code === 45 || code === 48) return ['fog', 0.8];
  if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ['rain', code >= 65 || code === 82 ? 1 : 0.5];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['snow', code >= 75 ? 1 : 0.5];
  if (code >= 95) return ['storm', 1];
  return ['cloudy', 0.5];
}

export function installWeather(ctx: Ctx): void {
  const { sky } = ctx;
  let pin: Partial<SkyState> | null = null;
  let preview: { hour?: number; weather?: Weather; intensity?: number } = {};
  let place = '';
  let busy = false;
  /** Fog thickness 0–1 set by hand (null: whatever the weather makes). The sky sets the fog each frame, so it is overridden right after. */
  let fog: number | null = null;
  const skyUpdate = sky.update.bind(sky);
  sky.update = (dt, t, camera) => {
    skyUpdate(dt, t, camera);
    if (fog !== null && ctx.scene.fog instanceof THREE.Fog) {
      // At 0 there is no fog or haze at all: the edges go out past anything drawn.
      const far = fog <= 0.001 ? 1e6 : 600 - (600 - 22) * Math.pow(fog, 0.55);
      ctx.scene.fog.far = far;
      ctx.scene.fog.near = fog <= 0.001 ? 1e5 : fog > 0.7 ? 0 : far * 0.25;
    }
  };

  const apply = () => {
    if (pin && store.sky) sky.set({ ...store.sky, ...pin });
    sky.show({ ...preview });
    paint();
  };
  // The server keeps sending its own sky: your place goes back over it each time.
  store.on('sky', () => pin && apply());

  const select = h('select', { 'aria-label': 'Location', onchange: () => void go(select.value) }) as HTMLSelectElement;
  select.append(h('option', { value: '' }, '📍 The office’s own place'), ...PLACES.map((p) => h('option', { value: p.name }, p.name)));
  const status = h('div.wx-status');
  const weatherRow = h('div.wx-row');
  const strength = h('input', { type: 'range', min: 0, max: 100, value: 80, 'aria-label': 'Weather strength', oninput: () => { preview = { ...preview, weather: preview.weather ?? store.sky?.weather ?? 'clear', intensity: Number(strength.value) / 100 }; apply(); }, onchange: () => strength.blur() }) as HTMLInputElement;
  const clock = h('input', { type: 'range', min: 0, max: 24, step: 0.25, value: 12, 'aria-label': 'Time of day', oninput: () => { preview = { ...preview, hour: Number(clock.value) % 24 }; apply(); }, onchange: () => clock.blur() }) as HTMLInputElement;
  const fogLabel = h('span.wx-val');
  const fogSlider = h('input', { type: 'range', min: 0, max: 100, value: 0, 'aria-label': 'Fog strength', oninput: () => { fog = Number(fogSlider.value) / 100; paint(); }, onchange: () => fogSlider.blur() }) as HTMLInputElement;
  const hourLabel = h('span.wx-val');
  const strengthLabel = h('span.wx-val');
  const live = (what: 'weather' | 'time') => h('button.btn.wx-mini', { type: 'button', onclick: () => {
    if (what === 'weather') {
      const { weather: _w, intensity: _i, ...rest } = preview;
      preview = rest;
      if (pin?.city) void go(place);
    } else {
      const { hour: _h, ...rest } = preview;
      preview = rest;
    }
    apply();
  } }, what === 'weather' ? 'Live' : 'Now');

  const body = h('div.wx-body', {},
    h('label.wx-label', {}, 'Where'), select, status,
    h('div.wx-head', {}, h('label.wx-label', {}, 'Weather'), live('weather')), weatherRow,
    h('div.wx-head', {}, h('label.wx-label', {}, 'Strength'), strengthLabel), strength,
    h('div.wx-head', {}, h('label.wx-label', {}, 'Fog'), fogLabel, h('button.btn.wx-mini', { type: 'button', onclick: () => { fog = null; paint(); } }, 'Auto')), fogSlider,
    h('div.wx-head', {}, h('label.wx-label', {}, 'Time of day'), hourLabel, live('time')), clock,
  );
  const toggle = h('button.wx-toggle', { type: 'button', 'aria-expanded': 'true', onclick: () => {
    const open = body.hidden;
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  } }, '🌦️ Weather');
  const panel = h('div.wx-panel', { id: 'weather-panel' }, toggle, body);
  document.getElementById('hud')?.append(panel);
  panel.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b) setTimeout(() => b.blur(), 0); });

  const fmtHour = (x: number) => { const m = Math.round(x * 60); return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

  function paint() {
    const s = store.sky;
    const now = pin ? { ...s, ...pin } : s;
    const w = preview.weather ?? now?.weather;
    weatherRow.replaceChildren(...WEATHER.map(([k, icon]) => h('button.btn.wx-btn', {
      type: 'button', title: k, 'aria-pressed': String(w === k), class: w === k ? 'on' : '',
      onclick: () => { preview = { ...preview, weather: k, intensity: preview.intensity ?? 0.8 }; strength.value = String(Math.round((preview.intensity ?? 0.8) * 100)); apply(); },
    }, icon)));
    const k = preview.intensity ?? (preview.weather ? 0.8 : now?.intensity ?? 0);
    strength.value = String(Math.round(k * 100));
    strengthLabel.textContent = Math.round(k * 100) + '%';
    fogLabel.textContent = fog === null ? 'auto' : Math.round(fog * 100) + '%';
    if (fog !== null) fogSlider.value = String(Math.round(fog * 100));
    hourLabel.textContent = preview.hour === undefined ? 'live' : fmtHour(preview.hour);
    status.textContent = busy ? 'Fetching the forecast…' : pin?.city ? pin.city + (pin.temp !== undefined ? ', ' + pin.temp + ' °C' : '') : now?.city ? now.city + (now.temp !== undefined ? ', ' + now.temp + ' °C' : '') : 'Using the office’s own sky';
  }

  async function go(name: string) {
    place = name;
    const p = PLACES.find((q) => q.name === name);
    if (!p) { pin = null; preview = {}; apply(); return; }
    pin = { lat: p.lat, lon: p.lon, utcOffset: p.utc, city: p.name, temp: undefined };
    apply();
    busy = true;
    paint();
    try {
      const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + p.lat + '&longitude=' + p.lon + '&current=temperature_2m,weather_code&timezone=auto');
      const f = await res.json();
      if (place !== name) return;
      const [weather, intensity] = fromWmo(Number(f.current.weather_code));
      pin = { lat: p.lat, lon: p.lon, city: p.name, utcOffset: Number.isFinite(f.utc_offset_seconds) ? Math.round(f.utc_offset_seconds / 60) : p.utc, weather, intensity, temp: Math.round(Number(f.current.temperature_2m)) };
    } catch {
      // No forecast reachable: the place's sun and clock still apply, with the weather as it was.
    }
    busy = false;
    apply();
  }

  paint();
  store.on('sky', paint);
}

