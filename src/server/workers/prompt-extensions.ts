import { DECISION_HANDOFF } from '../../shared/decision-prompts.js';
// Cross-provider launch extensions. Modules own their policy; the manager only composes them.
const EXTENSIONS = [DECISION_HANDOFF];
export function workerPrompt(prompt: string | undefined): string | undefined {
  if (!prompt?.trim() || prompt.startsWith('/')) return prompt;
  return [prompt, ...EXTENSIONS.filter(text => !prompt.includes(text))].join('\n\n');
}
export const stationRequest = (desk: string, text: string) => desk === 'station-issues' ? workerPrompt(text)! : text;
