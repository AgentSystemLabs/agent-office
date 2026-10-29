import path from 'node:path';
import type { AgentEffort } from '../../shared/providers.js';
import type { RoleId } from './types.js';

export interface RoleProviderConfig {
  provider: string;
  model?: string;
  effort?: AgentEffort;
}

export interface EditorialConfig {
  dataDir: string;
  storageDir: string;
  timezone: string;
  ownerId?: string;
  authorizedChatIds: string[];
  botToken?: string;
  maxConcurrentGenerations: number;
  budgetUsd?: number;
  warningThresholdUsd: number;
  provider: string;
  textModel: string;
  imageModel: string;
  autonomousMode: boolean;
  paidAdvertising: boolean;
  agentOfficeFloor?: string;
  agentOfficeProvider: 'claude' | 'opencode' | 'codex' | 'grok' | 'muse' | 'dsh' | 'pi' | 'cursor' | 'custom';
  roleProviders: Partial<Record<RoleId, RoleProviderConfig>>;
}

export function loadEditorialConfig(dataDir: string, env: NodeJS.ProcessEnv = process.env): EditorialConfig {
  const ownerId = numericId(env.TELEGRAM_OWNER_ID);
  const allowedChatIds = splitIds(env.TELEGRAM_ALLOWED_CHAT_IDS);
  if (ownerId && !allowedChatIds.includes(ownerId)) allowedChatIds.unshift(ownerId);
  const budgetUsd = positiveNumber(env.EDITORIAL_BUDGET_USD);
  const maxConcurrentGenerations = Math.min(20, Math.max(1, integer(env.EDITORIAL_MAX_CONCURRENT, 3)));
  return {
    dataDir,
    storageDir: path.join(dataDir, 'editorial'),
    timezone: env.APP_TIMEZONE?.trim() || 'America/Santo_Domingo',
    ownerId,
    authorizedChatIds: allowedChatIds,
    botToken: env.TELEGRAM_BOT_TOKEN?.trim() || undefined,
    maxConcurrentGenerations,
    budgetUsd,
    warningThresholdUsd: Math.max(0, Math.min(1, positiveNumber(env.EDITORIAL_BUDGET_WARNING_RATIO) ?? 0.8)),
    provider: env.EDITORIAL_PROVIDER?.trim().toLowerCase() || 'mock',
    textModel: env.EDITORIAL_TEXT_MODEL?.trim() || 'configured-text-model',
    imageModel: env.EDITORIAL_IMAGE_MODEL?.trim() || 'gpt-image-1',
    autonomousMode: booleanValue(env.EDITORIAL_AUTONOMOUS_MODE),
    paidAdvertising: env.EDITORIAL_PAID_ADVERTISING === '1' || env.EDITORIAL_PAID_ADVERTISING === 'true',
    agentOfficeFloor: env.EDITORIAL_AGENT_OFFICE_FLOOR?.trim() || undefined,
    agentOfficeProvider: validOfficeProvider(env.EDITORIAL_AGENT_OFFICE_PROVIDER),
    roleProviders: parseRoleProviders(env.EDITORIAL_ROLE_CONFIG_JSON),
  };
}

function numericId(value: string | undefined): string | undefined {
  return value && /^\d{1,20}$/.test(value.trim()) ? value.trim() : undefined;
}

function splitIds(value: string | undefined): string[] {
  return [...new Set((value ?? '').split(',').map((item) => numericId(item.trim())).filter((item): item is string => !!item))];
}

function integer(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function positiveNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function booleanValue(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === '1' || value?.trim().toLowerCase() === 'true';
}

function validOfficeProvider(value: string | undefined): EditorialConfig['agentOfficeProvider'] {
  return ['claude', 'opencode', 'codex', 'grok', 'muse', 'dsh', 'pi', 'cursor', 'custom'].includes(value ?? '') ? value as EditorialConfig['agentOfficeProvider'] : 'claude';
}

function parseRoleProviders(value: string | undefined): EditorialConfig['roleProviders'] {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const result: EditorialConfig['roleProviders'] = {};
    for (const [role, raw] of Object.entries(parsed)) {
      if (!raw || typeof raw !== 'object' || typeof (raw as Record<string, unknown>).provider !== 'string') continue;
      result[role as RoleId] = { provider: String((raw as Record<string, unknown>).provider), model: typeof (raw as Record<string, unknown>).model === 'string' ? String((raw as Record<string, unknown>).model) : undefined, effort: typeof (raw as Record<string, unknown>).effort === 'string' ? (raw as Record<string, unknown>).effort as AgentEffort : undefined };
    }
    return result;
  } catch {
    return {};
  }
}
