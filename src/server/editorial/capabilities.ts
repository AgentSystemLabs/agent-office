import type { CapabilityRow } from './types.js';

export function initialCapabilities(checkedAt = new Date().toISOString()): CapabilityRow[] {
  return [
    { capability: 'editorial-state', component: 'engine', state: 'implemented', evidence: ['SQLite schema and state transitions'], checkedAt },
    { capability: 'durable-queue', component: 'orchestrator', state: 'implemented', evidence: ['Lease/checkpoint implementation'], checkedAt },
    { capability: 'agent-office-association', component: 'agent-office-adapter', state: 'implemented', evidence: ['Worker/floor/run association table'], limitation: 'Dispatch requires a configured Agent Office floor', checkedAt },
    { capability: 'text-generation', component: 'provider.openai', state: 'requires_config', evidence: ['HTTP Responses adapter'], dependency: 'OPENAI_API_KEY and model', checkedAt },
    { capability: 'image-generation', component: 'provider.openai', state: 'requires_config', evidence: ['HTTP Images adapter'], dependency: 'OPENAI_API_KEY and image model', checkedAt },
    { capability: 'mock-generation', component: 'provider.mock', state: 'tested_local', evidence: ['Deterministic fixtures'], checkedAt },
    { capability: 'epub-export', component: 'documents', state: 'implemented', evidence: ['EPUB package writer'], checkedAt },
    { capability: 'pdf-export', component: 'documents', state: 'limited', evidence: ['Minimal text PDF writer'], limitation: 'Visual richness and print preflight remain limited until an external renderer is configured', checkedAt },
    { capability: 'kdp-preparation', component: 'kdp', state: 'implemented', evidence: ['Checklist, metadata and manifest generation'], checkedAt },
    { capability: 'kdp-automated-publish', component: 'kdp', state: 'unsupported', evidence: ['No public end-to-end API assumed'], limitation: 'Use assisted workflow; owner handles login/MFA/CAPTCHA', checkedAt },
    { capability: 'social-calendar', component: 'marketing', state: 'implemented', evidence: ['Durable schedule and export'], checkedAt },
    { capability: 'social-real-connector', component: 'marketing', state: 'requires_config', evidence: ['Connector interface'], dependency: 'Account and platform permissions', checkedAt },
    { capability: 'telegram', component: 'telegram', state: 'requires_config', evidence: ['Long-polling adapter and owner-ID checks'], dependency: 'TELEGRAM_BOT_TOKEN and TELEGRAM_OWNER_ID', checkedAt },
  ];
}
