/**
 * Office sounds, synthesized with Web Audio so there are no audio files to ship: the room's air and a
 * humming fridge, workers typing while they work, footsteps, the coffee machine, birds outside the
 * windows by day and crickets at night, rain and thunder, the odd rustle or phone, the gong, the dog
 * barking, and the dings when a worker needs you. And the lounge jukebox, whose tunes are in music.ts,
 * and up on the roof, the wind, the city far below and the DJ's drum and bass (../dnb.ts).
 *
 * Everything goes through one master gain that Settings turns down or mutes. Voice chat doesn't, and
 * the jukebox has a volume of its own.
 *
 * OfficeSound is all the rest of the office sees. What every sound shares (the context, the buses,
 * where your ears are, what runs every frame) is AudioCore in core.ts; each sound is a recipe in a
 * file of its own, beside this one (weather.ts, steps.ts and so on) or in its feature's folder
 * (features/golf/sound.ts, features/dog/sound.ts and so on), and this class only hands them the core.
 */
import type { GongWhy } from '../../shared/protocol';
import { birdsong, deskPhones, Fridge, nightCrickets, startRoomTone, startWind } from './ambience';
import { ding } from './alerts';
import { arcade } from '../features/cabinet/sound';
import { ball, type BallSound } from '../features/basketball/sound';
import { Dj, hiccup, pour } from '../features/bar/sound';
import { carDoor, crash, honk, Motors, type Engine } from '../features/cars/sound';
import { bonk, hatch, poleLanding, rung, slide, twirl } from '../features/climbing/sound';
import { coffee } from '../features/coffee/sound';
import { AudioCore, type Hall, type Listener } from './core';
import { bark, yip } from '../features/dog/sound';
import { cellDoor, thud } from '../features/workers/sound';
import { golf, type GolfSound } from '../features/golf/sound';
import { gong } from '../features/gong/sound';
import { Jukebox, type JukeboxPlay } from '../features/jukebox/sound';
import type { Pos } from './places';
import { pageTurn, paper, step, stepAt } from './steps';
import { toss, type TossSound } from '../features/bargames/sound';
import { fidgeting, Typing } from './typing';
import { Rain, thunder } from './weather';

export class OfficeSound {
  private readonly a: AudioCore = new AudioCore({ start: (ctx) => this.start(ctx), touched: () => this.music.touched() });
  private readonly music = new Jukebox(this.a, (text) => this.onMusicError?.(text));
  private readonly dj = new Dj(this.a);
  private readonly typing = new Typing(this.a);
  private readonly motors = new Motors(this.a);
  private readonly fridge = new Fridge(this.a);
  private readonly rain = new Rain(this.a);
  private readonly birds = birdsong(this.a);
  private readonly crickets = nightCrickets(this.a);
  private readonly phones = deskPhones(this.a);
  private readonly fidgets = fidgeting(this.a, this.typing);
  /** A stream that won't play here. */
  onMusicError?: (text: string) => void;
  /** How many of each sound have played, for quick checks from the console. */
  readonly played: Record<string, number> = this.a.played;

  constructor() {
    // What the room does every frame, in this order (it's the order the random numbers are drawn in).
    this.a.every((now) => this.music.hearJukebox(now));
    this.a.every((now) => this.typing.scheduleTyping(now));
    this.a.every((now) => this.fridge.tickFridge(now));
    this.a.every((now) => this.birds.tick(now));
    this.a.every((now) => this.crickets.tick(now));
    this.a.every((now) => this.rain.tickRain(now));
    this.a.every((now) => this.phones.tick(now));
    this.a.every((now) => this.fidgets.tick(now));
  }

  /** Audio has just started (see AudioCore.unlock): the jukebox and the DJ join the graph, and the room starts up. */
  private start(ctx: AudioContext) {
    this.music.connect(ctx);
    this.dj.connect(this.music.musicBus);
    this.a.applyVolume();
    this.music.applyMusicVolume();
    this.music.applyJukebox();
    this.a.applyVisibility();
    startRoomTone(this.a);
    this.fridge.startFridge();
    startWind(this.a);
    this.a.applyOutdoors();
    this.dj.applyDj();
    const now = ctx.currentTime;
    this.birds.start(now);
    this.crickets.start(now);
    this.phones.start(now);
    this.fidgets.start(now);
  }

  // ---- The room and you ---------------------------------------------------------------------------

  /** Volume is 0–1; muted silences everything without losing the level. */
  setVolume(volume: number, muted: boolean) {
    this.a.setVolume(volume, muted);
  }

  /** The weather outside (see world/sky.ts), every frame. */
  setWeather(rain: number, night: number) {
    this.a.setWeather(rain, night);
  }

  /** Output level (RMS) right now, for headless checks. */
  level(): number {
    return this.a.level();
  }

  /** The jukebox's level (RMS) where you stand, after your music volume. A stream doesn't show here. */
  musicLevel(): number {
    return this.music.musicLevel();
  }

  get state(): AudioContextState | 'locked' {
    return this.a.state;
  }

  /** How many rows the floor's back office is built out: in there you're indoors too. */
  get wing(): number {
    return this.a.wing;
  }

  set wing(level: number) {
    this.a.wing = level;
  }

  /** Moves your ears and schedules whatever the room does next. */
  update(l: Listener) {
    this.a.update(l);
  }

  /** On a map of its own, `hall` (see Hall); null back in the office. */
  setHall(hall: Hall | null) {
    this.a.hall = hall;
  }

  /** Up on the roof (true), or inside on a floor: the office's hum gives way to the wind and the city. */
  setOutdoors(on: boolean) {
    this.a.setOutdoors(on);
  }

  // ---- Workers, footsteps and paper (typing.ts, steps.ts) ---------------------------------------

  /** The worker at desk (x, z) types while `on`. */
  setTyping(id: string, x: number, z: number, on: boolean) {
    this.typing.setTyping(id, x, z, on);
  }

  removeTypist(id: string) {
    this.typing.removeTypist(id);
  }

  step(kind: 'walk' | 'land' = 'walk') {
    step(this.a, kind);
  }

  paper() {
    paper(this.a);
  }

  pageTurn() {
    pageTurn(this.a);
  }

  stepAt(x: number, z: number, y = 0) {
    stepAt(this.a, x, z, y);
  }

  // ---- The ladder, the fire poles and the dungeon (features/climbing, features/workers) ------------

  rung(soft = false) {
    rung(this.a, soft);
  }

  hatch(at: Pos, open: boolean) {
    hatch(this.a, at, open);
  }

  cellDoor(at: Pos, open: boolean) {
    cellDoor(this.a, at, open);
  }

  thud(at: Pos) {
    thud(this.a, at);
  }

  bonk() {
    bonk(this.a);
  }

  slide(seconds = 1.6) {
    slide(this.a, seconds);
  }

  twirl() {
    twirl(this.a);
  }

  poleLanding(speed: number, at?: Pos) {
    poleLanding(this.a, speed, at);
  }

  // ---- Games (features/golf, bargames, basketball and cabinet) -------------------------------------

  golf(kind: GolfSound, at?: Pos, speed = 5) {
    golf(this.a, kind, at, speed);
  }

  toss(kind: TossSound, at: Pos) {
    toss(this.a, kind, at);
  }

  ball(kind: BallSound, at: Pos, speed: number) {
    ball(this.a, kind, at, speed);
  }

  arcade(kind: 'land' | 'clear' | 'over', lines = 1) {
    arcade(this.a, kind, lines);
  }

  // ---- The cars in the garage (features/cars) -----------------------------------------------------

  setEngines(running: Engine[]) {
    this.motors.setEngines(running);
  }

  honk(at: Pos, high: boolean) {
    honk(this.a, at, high);
  }

  carDoor(at: Pos) {
    carDoor(this.a, at);
  }

  crash(at: Pos, speed: number) {
    crash(this.a, at, speed);
  }

  // ---- The kitchen, the dog, the weather, the gong, the dings --------------------------------------

  coffee() {
    coffee(this.a);
  }

  bark(x: number, z: number, times: number) {
    bark(this.a, x, z, times);
  }

  yip(x: number, z: number) {
    yip(this.a, x, z);
  }

  thunder(delay: number, loud: number) {
    thunder(this.a, delay, loud);
  }

  gong(why: GongWhy) {
    gong(this.a, why);
  }

  ding(kind: 'done' | 'needs_input') {
    ding(this.a, kind);
  }

  // ---- The rooftop bar (features/bar) -------------------------------------------------------------

  /** The DJ's set on the roof, `clock` saying how far into it it is (see djTime); null stops it. */
  setDj(clock: (() => number) | null) {
    this.dj.setDj(clock);
  }

  horn() {
    this.dj.horn();
  }

  pour(at: Pos) {
    pour(this.a, at);
  }

  hiccup() {
    hiccup(this.a);
  }

  // ---- The jukebox (features/jukebox) -------------------------------------------------------------

  /** What the jukebox on your floor plays, or null for nothing. It starts once the browser allows audio. */
  setJukebox(play: JukeboxPlay | null) {
    this.music.setJukebox(play);
  }

  /** Your own jukebox volume, 0–1, apart from the office sounds'. */
  setMusicVolume(volume: number, muted: boolean) {
    this.music.setMusicVolume(volume, muted);
  }

  /** 1 on each beat of the tune, falling to 0 before the next, for the jukebox's lights. */
  beat(): number {
    return this.music.beat();
  }
}
