import { h } from '../../ui/dom';
import { BOT_PROFILES, BOT_DIFFICULTIES, validBotOptions, type BotOptions } from '../../../shared/fps-bots';

const KEY = 'agent-office.fps-sensitivity';
const BOT_KEY = 'agent-office.fps-bot';
export const validSensitivity = (value: number) => Number.isFinite(value) ? Math.max(.2, Math.min(3, value)) : 1;

export class FpsPreferences {
  sensitivity = 1;
  bot: BotOptions = { profile: 'flanker', difficulty: 'hard' };
  constructor() {
    try { const saved = localStorage.getItem(KEY); if (saved !== null) this.sensitivity = validSensitivity(Number(saved)); } catch { /* Storage may be disabled. */ }
    try { const saved = JSON.parse(localStorage.getItem(BOT_KEY) ?? 'null'); if (validBotOptions(saved)) this.bot = saved; } catch { /* Keep defaults. */ }
  }
  control(change: (value: number) => void) {
    const value = h('output', {}, `${this.sensitivity.toFixed(2)}×`);
    const slider = h('input', { type: 'range', min: .2, max: 3, step: .05, value: this.sensitivity, 'aria-label': '瞄准灵敏度', oninput: () => {
      this.sensitivity = validSensitivity(Number(slider.value)); value.textContent = `${this.sensitivity.toFixed(2)}×`;
      try { localStorage.setItem(KEY, String(this.sensitivity)); } catch { /* Still applies for this session. */ }
      change(this.sensitivity);
    } });
    return h('label.fps-setting', {}, h('span', {}, '瞄准灵敏度', value), slider, h('small', {}, '0.20× 慢速精瞄 — 3.00× 快速转身 · 自动保存'));
  }
  botControl(initial = this.bot) {
    const profile = h('select', { 'aria-label': 'AI 对手' }, ...Object.entries(BOT_PROFILES).map(([key, bot]) => h('option', { value: key }, bot.name)));
    const difficulty = h('select', { 'aria-label': '人机强度' }, ...Object.entries(BOT_DIFFICULTIES).map(([key, label]) => h('option', { value: key }, label)));
    profile.value = initial.profile; difficulty.value = initial.difficulty;
    const description = h('small', {}, BOT_PROFILES[initial.profile].description);
    const options = (): BotOptions => ({ profile: profile.value as BotOptions['profile'], difficulty: difficulty.value as BotOptions['difficulty'] });
    const save = () => { this.bot = options(); description.textContent = BOT_PROFILES[this.bot.profile].description;
      try { localStorage.setItem(BOT_KEY, JSON.stringify(this.bot)); } catch { /* Session settings still work. */ } };
    profile.addEventListener('change', save); difficulty.addEventListener('change', save);
    return { root: h('div.fps-bot-settings', {}, h('label.fps-setting', {}, 'AI 对手', profile), description,
      h('label.fps-setting', {}, '人机强度', difficulty), h('small', {}, '强度影响反应、准度与射击节奏；生命、伤害和弹药规则相同。')), options };
  }
}
