// The models a Claude Code worker can move itself between, by how big its task is. Each tier is a
// model name Claude Code takes after /model. By default they are the router's own tiers (CLIProxy's
// Fallback Tiers page: tier-high, tier-medium, tier-low), which fail over between the models set there.
// AGENT_OFFICE_MODEL_TIERS renames them, e.g. "high=tier-high,low=gpt-5.6-mini". Opus is never picked.

export const MODEL_TIERS = ['high', 'medium', 'low'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

const DEFAULTS: Record<ModelTier, string> = { high: 'tier-high', medium: 'tier-medium', low: 'tier-low' };
/** What /model is given: a model name, nothing a terminal could treat as more than one word. */
/** Nothing above Sonnet. */
const NO_OPUS = /opus/i;
const MODEL_NAME = /^[\w][\w.:/\-[\]]{0,99}$/;

export function modelTiers(env: NodeJS.ProcessEnv = process.env): Record<ModelTier, string> {
  const out = { ...DEFAULTS };
  for (const part of (env.AGENT_OFFICE_MODEL_TIERS ?? '').split(',')) {
    const [tier, name] = part.split('=').map((s) => s.trim());
    if ((MODEL_TIERS as readonly string[]).includes(tier) && name && MODEL_NAME.test(name) && !NO_OPUS.test(name)) out[tier as ModelTier] = name;
  }
  return out;
}

/** The model to switch to: a tier's, or a named one; a string says what's wrong. */
export function pickModel(tier: unknown, model: unknown, env?: NodeJS.ProcessEnv): { model: string; tier?: ModelTier } | string {
  if (typeof model === 'string' && model.trim()) {
    const name = model.trim();
    if (NO_OPUS.test(name)) return 'Opus is not available here: pick a tier, or a model from the router';
    return MODEL_NAME.test(name) ? { model: name } : 'model is a model name from the router, like tier-medium';
  }
  if (!(MODEL_TIERS as readonly string[]).includes(tier as string)) return `Say tier (${MODEL_TIERS.join(', ')}) or model`;
  return { model: modelTiers(env)[tier as ModelTier], tier: tier as ModelTier };
}
