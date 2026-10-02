import { readFileSync, writeFileSync } from 'node:fs';
import type { SkyState, Weather } from '../shared/protocol.js';
import { guessPlace } from '../shared/sun.js';

// The sky over the office: where it is (which sets when the sun rises and sets) and the weather.
// With --city, both follow that city's live forecast from open-meteo.com (free, no key needed).
// Without one, the office sits in the host's time zone and the weather wanders by itself, one
// spell after another, with snow only in winter. --weather pins it either way.

const FORECAST_MS = 15 * 60_000;
/** After a forecast that didn't come: soon at first (a network still waking up), then every couple of minutes. */
const RETRY_MS = [15_000, 30_000, 60_000, 2 * 60_000];
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** WMO weather codes, which open-meteo reports, as our weather and how hard it's coming down. */
const WMO: Record<number, [Weather, number]> = {
  0: ['clear', 0],
  1: ['clear', 0],
  2: ['cloudy', 0.4],
  3: ['cloudy', 1],
  45: ['fog', 0.8],
  48: ['fog', 1],
  51: ['rain', 0.2],
  53: ['rain', 0.3],
  55: ['rain', 0.4],
  56: ['rain', 0.3],
  57: ['rain', 0.45],
  61: ['rain', 0.45],
  63: ['rain', 0.7],
  65: ['rain', 1],
  66: ['rain', 0.5],
  67: ['rain', 0.9],
  71: ['snow', 0.35],
  73: ['snow', 0.65],
  75: ['snow', 1],
  77: ['snow', 0.3],
  80: ['rain', 0.5],
  81: ['rain', 0.75],
  82: ['rain', 1],
  85: ['snow', 0.6],
  86: ['snow', 1],
  95: ['storm', 0.8],
  96: ['storm', 1],
  99: ['storm', 1],
};

export function fromWmo(code: number): { weather: Weather; intensity: number } {
  const [weather, intensity] = WMO[code] ?? ['cloudy', 0.5];
  return { weather, intensity };
}

interface Place {
  lat: number;
  lon: number;
  /** What to call it, e.g. "Berlin, Germany". */
  name: string;
}

/** The next spell of made-up weather: likelier to stay as it is, snow only in winter, storms in summer. */
export function wander(prev: Weather | null, month: number, south: boolean): { weather: Weather; intensity: number } {
  const season = Math.floor((((south ? month + 6 : month) % 12) + 1) / 3) % 4; // 0 winter, 1 spring, 2 summer, 3 autumn
  const odds: Record<Weather, number>[] = [
    { clear: 30, cloudy: 25, rain: 10, storm: 0, snow: 25, fog: 10 },
    { clear: 40, cloudy: 25, rain: 20, storm: 5, snow: 0, fog: 10 },
    { clear: 55, cloudy: 15, rain: 15, storm: 10, snow: 0, fog: 5 },
    { clear: 35, cloudy: 25, rain: 25, storm: 3, snow: 0, fog: 12 },
  ];
  const w = { ...odds[season] };
  if (prev && w[prev] > 0) w[prev] += 25;
  let r = Math.random() * Object.values(w).reduce((a, b) => a + b, 0);
  let weather: Weather = 'clear';
  for (const [k, v] of Object.entries(w) as [Weather, number][]) {
    weather = k;
    if ((r -= v) < 0) break;
  }
  return { weather, intensity: weather === 'clear' ? 0 : Math.round(rand(0.35, 1) * 100) / 100 };
}

/** Weather set with --weather, coming down fairly hard. */
const pinned = (weather: Weather) => ({ weather, intensity: weather === 'clear' ? 0 : 0.8 });

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'agent-office' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** "Berlin", "Paris, France", "Portland, Oregon" or "52.52,13.41". Null when there's no such place. */
async function locate(city: string): Promise<Place | null> {
  const coords = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(city);
  if (coords) return { lat: Number(coords[1]), lon: Number(coords[2]), name: city.trim() };
  const [name, ...rest] = city.split(',').map((s) => s.trim());
  const where = rest.join(' ').toLowerCase();
  const data = await getJson(`${GEOCODE}?name=${encodeURIComponent(name)}&count=10&language=en&format=json`);
  const hits: any[] = Array.isArray(data?.results) ? data.results : [];
  const hit = (where && hits.find((h) => [h.country, h.country_code, h.admin1].some((s) => typeof s === 'string' && where.includes(s.toLowerCase())))) || hits[0];
  if (!hit || typeof hit.latitude !== 'number' || typeof hit.longitude !== 'number') return null;
  return { lat: hit.latitude, lon: hit.longitude, name: [hit.name, hit.country].filter(Boolean).join(', ') };
}

export class Sky {
  state: SkyState;
  private timer: NodeJS.Timeout | null = null;
  private place: Place | null = null;
  /** Whether we've said the forecast is missing, so a flaky network doesn't flood the log. */
  private warned = false;
  /** Forecasts missed in a row (see RETRY_MS). */
  private misses = 0;
  /** The sky keeps the real time of day, not a day every hour (see setClock). */
  private realTime: boolean;

  constructor(
    private opts: { city?: string; weather?: Weather; realTime?: boolean; placeFile?: string; clockFile?: string },
    private onChange: (state: SkyState) => void,
  ) {
    this.realTime = this.savedClock() ?? !!opts.realTime;
    const now = new Date();
    const here = guessPlace(now);
    const weather = opts.weather ? pinned(opts.weather) : opts.city ? pinned('clear') : wander(null, now.getMonth(), here.lat < 0);
    // The city where the last forecast put it, so a restart is already there before the next one comes.
    const known = opts.city ? this.knownPlace(opts.city) : undefined;
    this.state = known
      ? { lat: known.lat, lon: known.lon, utcOffset: known.utcOffset, ...weather, city: known.name, ...(this.realTime ? { realTime: true } : {}) }
      : { ...here, utcOffset: -now.getTimezoneOffset(), ...weather, ...(this.realTime ? { realTime: true } : {}) };
    if (known) this.place = { lat: known.lat, lon: known.lon, name: known.name };
  }

  /** Where the last forecast for `city` put it (see placeFile), if it's that city. */
  private knownPlace(city: string): { lat: number; lon: number; name: string; utcOffset: number } | undefined {
    if (!this.opts.placeFile) return undefined;
    try {
      const p = JSON.parse(readFileSync(this.opts.placeFile, 'utf8'));
      return p?.city === city && [p.lat, p.lon, p.utcOffset].every(Number.isFinite) && typeof p.name === 'string' ? p : undefined;
    } catch {
      return undefined;
    }
  }

  start() {
    if (this.opts.city) void this.forecast();
    else this.later(rand(20, 50) * 60_000, () => this.drift());
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private later(ms: number, fn: () => void) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(fn, ms);
    this.timer.unref();
  }

  /**
   * Which clock the sky keeps, picked in ⚙️ Settings: the real time of day (true), or a whole day and
   * night every hour. Kept in clockFile, so it outlasts a restart; until someone picks, --real-time-sky says.
   */
  setClock(real: boolean) {
    this.realTime = real;
    if (this.opts.clockFile) {
      try {
        writeFileSync(this.opts.clockFile, JSON.stringify({ realTime: real }));
      } catch {
        // It still changes for now.
      }
    }
    this.set({ ...this.state });
  }

  private savedClock(): boolean | undefined {
    if (!this.opts.clockFile) return undefined;
    try {
      const saved = JSON.parse(readFileSync(this.opts.clockFile, 'utf8'));
      return typeof saved?.realTime === 'boolean' ? saved.realTime : undefined;
    } catch {
      return undefined;
    }
  }

  private set(next: SkyState) {
    const { realTime: _, ...rest } = next;
    next = this.realTime ? { ...rest, realTime: true } : rest;
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    this.onChange(next);
  }

  /** Made-up weather: a new spell every 20–50 minutes, in the host's time zone. */
  private drift() {
    const now = new Date();
    const here = guessPlace(now);
    const weather = this.opts.weather ? pinned(this.opts.weather) : wander(this.state.weather, now.getMonth(), here.lat < 0);
    this.set({ ...here, utcOffset: -now.getTimezoneOffset(), ...weather });
    this.later(rand(20, 50) * 60_000, () => this.drift());
  }

  private async forecast() {
    const city = this.opts.city!;
    try {
      this.place ??= await locate(city);
      if (!this.place) {
        console.warn(`agent-office: couldn't find the city "${city}"; the weather is made up instead`);
        this.opts.city = undefined;
        return this.drift();
      }
      const { lat, lon, name } = this.place;
      const f = await getJson(`${FORECAST}?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`);
      const code = Number(f?.current?.weather_code);
      if (!Number.isFinite(code)) throw new Error('no current weather in the forecast');
      const weather = this.opts.weather ? pinned(this.opts.weather) : fromWmo(code);
      const temp = Number(f.current.temperature_2m);
      const utcOffset = Number.isFinite(f.utc_offset_seconds) ? Math.round(f.utc_offset_seconds / 60) : this.state.utcOffset;
      this.set({ lat, lon, utcOffset, ...weather, city: name, temp: Number.isFinite(temp) ? Math.round(temp) : undefined });
      if (this.warned) console.log(`agent-office: the weather for ${name} came through`);
      this.warned = false;
      this.misses = 0;
      if (this.opts.placeFile) {
        try {
          writeFileSync(this.opts.placeFile, JSON.stringify({ city, lat, lon, name, utcOffset }));
        } catch {
          // Only a head start for the next restart.
        }
      }
      this.later(FORECAST_MS, () => void this.forecast());
    } catch (err) {
      const e = err as Error & { cause?: { code?: string; message?: string } };
      const why = [e.message, e.cause?.code ?? e.cause?.message].filter(Boolean).join(': ');
      if (!this.warned) console.warn(`agent-office: no weather for ${city} yet (${why}); trying again shortly`);
      this.warned = true;
      this.later(RETRY_MS[Math.min(this.misses++, RETRY_MS.length - 1)], () => void this.forecast());
    }
  }
}
