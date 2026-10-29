import type { UsageSnapshot } from './types.js';

export interface TextGenerationRequest {
  systemPrompt: string;
  prompt: string;
  model: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface TextGenerationResult {
  text: string;
  provider: string;
  model: string;
  usage: UsageSnapshot;
  evidence: { kind: 'service'; ref: string; observedAt: string; note?: string }[];
}

export interface ImageGenerationRequest {
  prompt: string;
  model: string;
  size?: string;
  quality?: string;
  outputFormat?: 'png' | 'jpeg' | 'webp';
}

export interface ImageGenerationResult {
  bytes: Uint8Array;
  mimeType: string;
  provider: string;
  model: string;
  usage: UsageSnapshot;
  evidence: { kind: 'service'; ref: string; observedAt: string; note?: string }[];
}

export interface EditorialProvider {
  readonly id: string;
  readonly configured: boolean;
  generateText(request: TextGenerationRequest, signal?: AbortSignal): Promise<TextGenerationResult>;
  generateImage(request: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult>;
}

export class MockEditorialProvider implements EditorialProvider {
  readonly id = 'mock';
  readonly configured = true;

  async generateText(request: TextGenerationRequest): Promise<TextGenerationResult> {
    const title = request.prompt.split(/\s+/).filter(Boolean).slice(0, 8).join(' ') || 'obra breve';
    const text = `Borrador de prueba para «${title}».\n\nEsta salida procede del proveedor mock y debe permanecer identificada como simulación.`;
    return { text, provider: this.id, model: request.model, usage: { source: 'estimate', estimatedCostUsd: 0 }, evidence: [{ kind: 'service', ref: 'mock://editorial/text', observedAt: new Date().toISOString(), note: 'Proveedor determinista de prueba; no es un servicio real.' }] };
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const label = escapeXml(request.prompt.slice(0, 80));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#172033"/><circle cx="512" cy="420" r="230" fill="#e4a853"/><path d="M150 820 Q512 600 874 820" fill="none" stroke="#f7f1e3" stroke-width="36"/><text x="512" y="930" fill="#f7f1e3" text-anchor="middle" font-family="sans-serif" font-size="28">MOCK — ${label}</text></svg>`;
    return { bytes: new TextEncoder().encode(svg), mimeType: 'image/svg+xml', provider: this.id, model: request.model, usage: { source: 'estimate', estimatedCostUsd: 0 }, evidence: [{ kind: 'service', ref: 'mock://editorial/image', observedAt: new Date().toISOString(), note: 'Ilustración SVG de prueba; no es una imagen generada por un proveedor real.' }] };
  }
}

export interface OpenAIProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * OpenAI Responses and Images adapters use the documented HTTP endpoints rather than assuming a
 * subscription includes API access. References: https://developers.openai.com/api/reference/resources/responses
 * and https://developers.openai.com/api/reference/resources/images.
 */
export class OpenAIEditorialProvider implements EditorialProvider {
  readonly id = 'openai';
  readonly configured: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: OpenAIProviderOptions = {}) {
    this.configured = !!options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  }

  async generateText(request: TextGenerationRequest, signal?: AbortSignal): Promise<TextGenerationResult> {
    const body = {
      model: request.model,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: request.systemPrompt }] },
        { role: 'user', content: [{ type: 'input_text', text: request.prompt }] },
      ],
      ...(request.maxOutputTokens ? { max_output_tokens: request.maxOutputTokens } : {}),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    };
    const response = await this.request('/responses', body, signal);
    const text = response.output_text ?? extractResponseText(response.output);
    if (!text) throw new Error('OpenAI response did not contain output text');
    return { text, provider: this.id, model: request.model, usage: usageFromResponse(response.usage), evidence: [{ kind: 'service', ref: `${this.baseUrl}/responses`, observedAt: new Date().toISOString(), note: 'Respuesta recibida del endpoint configurado.' }] };
  }

  async generateImage(request: ImageGenerationRequest, signal?: AbortSignal): Promise<ImageGenerationResult> {
    const response = await this.request('/images/generations', {
      model: request.model,
      prompt: request.prompt,
      ...(request.size ? { size: request.size } : {}),
      ...(request.quality ? { quality: request.quality } : {}),
      ...(request.outputFormat ? { output_format: request.outputFormat } : {}),
    }, signal);
    const first = Array.isArray(response.data) ? response.data[0] : undefined;
    if (!first || typeof first !== 'object') throw new Error('OpenAI image response did not contain image data');
    if (typeof first.b64_json === 'string') {
      const format = request.outputFormat ?? 'png';
      return { bytes: Buffer.from(first.b64_json, 'base64'), mimeType: `image/${format}`, provider: this.id, model: request.model, usage: usageFromResponse(response.usage), evidence: [{ kind: 'service', ref: `${this.baseUrl}/images/generations`, observedAt: new Date().toISOString(), note: 'Imagen recibida como base64 del endpoint configurado.' }] };
    }
    if (typeof first.url === 'string') {
      const image = await this.fetchImpl(first.url, { signal });
      if (!image.ok) throw new Error(`OpenAI image download failed (${image.status})`);
      return { bytes: new Uint8Array(await image.arrayBuffer()), mimeType: image.headers.get('content-type') || 'image/png', provider: this.id, model: request.model, usage: usageFromResponse(response.usage), evidence: [{ kind: 'service', ref: first.url, observedAt: new Date().toISOString(), note: 'URL temporal descargada inmediatamente; no se guarda la credencial.' }] };
    }
    throw new Error('OpenAI image response contained neither b64_json nor url');
  }

  private async request(endpoint: string, body: unknown, signal?: AbortSignal): Promise<any> {
    if (!this.options.apiKey) throw new Error('OPENAI_API_KEY is not configured');
    const response = await this.fetchImpl(`${this.baseUrl}${endpoint}`, { method: 'POST', headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message = payload && typeof payload === 'object' && 'error' in payload && payload.error && typeof payload.error === 'object' && 'message' in payload.error ? String(payload.error.message) : `HTTP ${response.status}`;
      throw new Error(`OpenAI request failed: ${message}`);
    }
    return payload;
  }
}

export function providerFromEnvironment(env: NodeJS.ProcessEnv = process.env): EditorialProvider {
  const provider = (env.EDITORIAL_PROVIDER ?? 'mock').trim().toLowerCase();
  if (provider === 'openai') return new OpenAIEditorialProvider({ apiKey: env.OPENAI_API_KEY, baseUrl: env.OPENAI_BASE_URL });
  return new MockEditorialProvider();
}

function usageFromResponse(value: unknown): UsageSnapshot {
  if (!value || typeof value !== 'object') return { source: 'unavailable' };
  const record = value as Record<string, unknown>;
  const input = numberOrUndefined(record.input_tokens);
  const output = numberOrUndefined(record.output_tokens);
  return { inputTokens: input, outputTokens: output, source: input === undefined && output === undefined ? 'unavailable' : 'provider' };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function extractResponseText(output: unknown): string {
  if (!Array.isArray(output)) return '';
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string') parts.push(String((part as Record<string, unknown>).text));
    }
  }
  return parts.join('');
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
