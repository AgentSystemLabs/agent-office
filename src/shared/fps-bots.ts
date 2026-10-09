export const BOT_PROFILES = {
  assault: { name: 'AI · 突击手', description: '主动压近，以身体连射为主' },
  flanker: { name: 'AI · 游击手', description: '绕侧巡逻，交火时横移' },
  marksman: { name: 'AI · 神枪手', description: '偏好远距离与爆头，瞄准更准' },
} as const;
export const BOT_DIFFICULTIES = { easy: '简单', normal: '普通', hard: '困难', expert: '专家' } as const;
export type BotProfile = keyof typeof BOT_PROFILES;
export type BotDifficulty = keyof typeof BOT_DIFFICULTIES;
export interface BotOptions { profile: BotProfile; difficulty: BotDifficulty }
export function validBotOptions(value: unknown): value is BotOptions {
  if (!value || typeof value !== 'object') return false;
  const v = value as BotOptions;
  return typeof v.profile === 'string' && Object.hasOwn(BOT_PROFILES, v.profile)
    && typeof v.difficulty === 'string' && Object.hasOwn(BOT_DIFFICULTIES, v.difficulty);
}
