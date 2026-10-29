import type { EditorialRuntime } from './runtime.js';
import { seededBrief } from './runtime.js';
import { profileFor } from './profiles.js';
import type { ApprovalAction, ProjectRecord, RoleId } from './types.js';

interface TelegramUser { id: number; first_name?: string; username?: string }
interface TelegramChat { id: number }
interface TelegramMessage { message_id: number; from?: TelegramUser; chat: TelegramChat; text?: string; caption?: string; document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number }; }
interface TelegramCallback { id: string; from: TelegramUser; data?: string; message?: TelegramMessage }
interface TelegramUpdate { update_id: number; message?: TelegramMessage; callback_query?: TelegramCallback }
interface TelegramResponse<T> { ok: boolean; result: T; description?: string }
interface TelegramFile { file_path?: string; file_size?: number }

export class TelegramBot {
  private stopped = false;
  private running = false;
  private offset?: number;

  constructor(private readonly runtime: EditorialRuntime, private readonly token?: string, private readonly ownerId?: string, private readonly allowedChatIds: string[] = []) {}

  get configured(): boolean {
    return !!this.token && !!this.ownerId;
  }

  start(): void {
    if (!this.configured || this.running) return;
    this.stopped = false;
    this.running = true;
    void this.poll();
  }

  stop(): void {
    this.stopped = true;
    this.running = false;
  }

  async notify(text: string, chatId = this.ownerId): Promise<void> {
    if (!this.configured || !chatId) return;
    await this.sendText(chatId, text);
  }

  private async poll(): Promise<void> {
    while (!this.stopped) {
      try {
        const updates = await this.call<TelegramUpdate[]>('getUpdates', { ...(this.offset === undefined ? {} : { offset: this.offset }), timeout: 25, limit: 50, allowed_updates: ['message', 'callback_query'] });
        for (const update of updates) {
          this.offset = update.update_id + 1;
          if (!this.runtime.repo.rememberTelegramUpdate(update.update_id)) continue;
          await this.handle(update);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Telegram polling failed';
        this.runtime.repo.audit('telegram', 'poll.error', undefined, undefined, undefined, { message: redact(message) });
        await wait(2000);
      }
    }
  }

  private async handle(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) return this.handleCallback(update.callback_query);
    const message = update.message;
    if (!message?.from) return;
    if (!this.authorized(message.from.id, message.chat.id)) {
      await this.sendText(String(message.chat.id), 'No autorizado. El bot solo acepta el identificador numérico configurado del propietario.');
      this.runtime.repo.audit('telegram', 'message.denied', undefined, undefined, undefined, { userId: String(message.from.id), chatId: String(message.chat.id) });
      return;
    }
    if (message.document) return this.document(String(message.chat.id), message);
    if (message.text) await this.command(String(message.chat.id), message.text.trim());
  }

  private async command(chatId: string, text: string): Promise<void> {
    const [head, ...rest] = text.split(/\s+/);
    const command = head.toLowerCase().split('@')[0];
    const arg = rest.join(' ').trim();
    if (command === '/start' || command === '/ayuda') return this.sendText(chatId, helpText());
    if (command === '/configurar') return this.sendText(chatId, `Configuración editorial\nZona horaria: ${this.runtime.config.timezone}\nProveedor: ${this.runtime.provider.id} (${this.runtime.provider.configured ? 'configurado' : 'sin credencial'})\nTelegram: configurado\nMáximo simultáneo: ${this.runtime.config.maxConcurrentGenerations}`);
    if (command === '/proyectos') return this.sendText(chatId, formatProjects(this.runtime.snapshot().projects));
    if (command === '/agentes') return this.sendText(chatId, Object.values(runtimeSnapshotProfiles()).map((profile) => `${profile.displayName} — ${profile.id}`).join('\n'));
    if (command === '/estado') return this.sendText(chatId, formatProjectStatus(this.runtime, arg));
    if (command === '/tareas') return this.sendText(chatId, formatTasks(this.runtime, arg));
    if (command === '/costos') return this.sendText(chatId, formatCosts(this.runtime));
    if (command === '/nuevo_libro') return this.newBook(chatId, arg || 'Libro sin título');
    if (command === '/ideas') return this.newIdeasTask(chatId, arg);
    if (command === '/pausar') return this.pause(chatId, arg);
    if (command === '/continuar') return this.resume(chatId, arg);
    if (command === '/cancelar') return this.cancel(chatId, arg);
    if (command === '/aprobaciones') return this.approvals(chatId);
    if (command === '/publicar') return this.publish(chatId, arg);
    if (command === '/redes' || command === '/calendario') return this.sendText(chatId, 'El calendario social se prepara localmente y requiere conectar una cuenta antes de publicar.');
    if (command === '/respaldos') return this.sendText(chatId, 'El respaldo se ejecuta desde el diagnóstico/CLI para evitar enviar SQLite o archivos privados por Telegram.');
    if (text.startsWith('/')) return this.sendText(chatId, 'Comando no reconocido. Usa /ayuda.');
    return this.newBook(chatId, text);
  }

  private async newBook(chatId: string, title: string): Promise<void> {
    const project = this.runtime.createProject(seededBrief(title));
    const tasks = this.runtime.createBookWorkflow(project.id);
    await this.sendText(chatId, `Proyecto creado: ${project.title}\nID: ${project.id}\nEstado: ${this.runtime.repo.getProject(project.id)?.stage}\nFlujo creado: ${tasks.length} tareas encadenadas.`);
  }

  private async newIdeasTask(chatId: string, hint: string): Promise<void> {
    const project = this.runtime.createProject(seededBrief(hint || 'Propuestas editoriales', { objective: hint || 'Proponer varias ideas comparables para un nuevo libro.' }));
    this.runtime.createTask('owner', { projectId: project.id, roleId: 'researcher', objective: 'Proponer varias ideas de libro comparables y registrar fuentes relevantes.', scope: hint || 'Sin restricción adicional', inputRevisionIds: [], dependencyTaskIds: [], acceptanceCriteria: ['Tres propuestas comparables', 'Hechos e hipótesis diferenciados', 'Fuentes registradas o pendientes explícitos'], tools: ['web.read', 'source.record', 'artifact.write'], timeoutSeconds: 1200, maxAttempts: 2, resultDestination: 'research' });
    await this.sendText(chatId, `Tarea de ideas creada en ${project.id}. Consulta /estado ${project.id}.`);
  }

  private async pause(chatId: string, projectId: string): Promise<void> {
    const project = this.runtime.repo.getProject(projectId);
    if (!project) return this.sendText(chatId, 'Indica un project_id válido.');
    this.runtime.repo.updateProjectStage(project.id, 'paused', true);
    await this.sendText(chatId, `Proyecto pausado: ${project.id}. Las respuestas tardías no sustituyen revisiones canceladas.`);
  }

  private async resume(chatId: string, projectId: string): Promise<void> {
    const project = this.runtime.repo.getProject(projectId);
    if (!project) return this.sendText(chatId, 'Indica un project_id válido.');
    this.runtime.repo.updateProjectStage(project.id, 'idea', false);
    await this.sendText(chatId, `Proyecto reanudado desde una etapa segura: ${project.id}. Revisa el plan antes de continuar.`);
  }

  private async cancel(chatId: string, taskId: string): Promise<void> {
    if (!taskId || !this.runtime.orchestrator.cancel(taskId)) return this.sendText(chatId, 'No se pudo cancelar esa tarea o ya no está activa.');
    await this.sendText(chatId, `Tarea cancelada: ${taskId}.`);
  }

  private async approvals(chatId: string): Promise<void> {
    const approvals = this.runtime.repo.listApprovals().filter((approval) => ['pending', 'approved'].includes(approval.state));
    if (!approvals.length) return this.sendText(chatId, 'No hay aprobaciones pendientes.');
    for (const approval of approvals) await this.sendText(chatId, `${approval.action} · ${approval.state} · ${approval.subjectId}\nVence: ${approval.expiresAt}`, approval.state === 'pending' ? { inline_keyboard: [[{ text: 'Aprobar', callback_data: `a:${approval.id}` }, { text: 'Rechazar', callback_data: `r:${approval.id}` }]] } : undefined);
  }

  private async handleCallback(callback: TelegramCallback): Promise<void> {
    const chatId = callback.message?.chat.id;
    const [action, approvalId] = callback.data?.split(':', 2) ?? [];
    if (!chatId || !this.authorized(callback.from.id, chatId) || !approvalId || !['a', 'r'].includes(action)) return this.answerCallback(callback.id, 'No autorizado');
    try {
      const approval = action === 'a' ? this.runtime.approveApproval(approvalId) : this.runtime.rejectApproval(approvalId);
      await this.answerCallback(callback.id, action === 'a' ? 'Aprobación registrada' : 'Aprobación rechazada');
      await this.sendText(String(chatId), `${action === 'a' ? 'Aprobada' : 'Rechazada'}: ${approval.action} · ${approval.subjectId}\nLa publicación externa no se ejecuta automáticamente; usa /publicar con el release aprobado.`);
    } catch (error) {
      await this.answerCallback(callback.id, error instanceof Error ? error.message.slice(0, 180) : 'Aprobación inválida');
    }
  }

  private async publish(chatId: string, releaseId: string): Promise<void> {
    if (!releaseId) return this.sendText(chatId, 'Indica el release_id auditado y aprobado.');
    try {
      const release = this.runtime.prepareApprovedRelease(releaseId);
      await this.sendText(chatId, `Paquete preparado para asistencia: ${release.id}. No se inició publicación externa.`);
    } catch (error) {
      await this.sendText(chatId, `No se puede preparar el release: ${error instanceof Error ? error.message : 'error desconocido'}`);
    }
  }

  private async document(chatId: string, message: TelegramMessage): Promise<void> {
    const document = message.document;
    if (!document) return;
    if ((document.file_size ?? 0) > 20 * 1024 * 1024) return this.sendText(chatId, 'El archivo supera el límite de 20 MB de descarga de Telegram.');
    const projectId = (message.caption ?? '').trim().split(/\s+/)[0];
    if (!projectId) return this.sendText(chatId, 'Adjunta el archivo con un caption que empiece por el project_id.');
    try {
      const file = await this.call<TelegramFile>('getFile', { file_id: document.file_id });
      if (!file.file_path) throw new Error('Telegram no devolvió file_path');
      const response = await fetch(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`);
      if (!response.ok) throw new Error(`Descarga Telegram falló (${response.status})`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const artifact = this.runtime.ingestTelegramDocument(projectId, document.file_name ?? 'upload.bin', bytes, document.mime_type);
      await this.sendText(chatId, `Archivo incorporado: ${artifact.id}\nHash: ${artifact.sha256}`);
    } catch (error) {
      await this.sendText(chatId, `No se pudo incorporar el archivo: ${error instanceof Error ? error.message : 'error desconocido'}`);
    }
  }

  private authorized(userId: number, chatId: number): boolean {
    return String(userId) === this.ownerId && (this.allowedChatIds.length === 0 || this.allowedChatIds.includes(String(chatId)));
  }

  private async sendText(chatId: string, text: string, reply_markup?: unknown): Promise<void> {
    for (const chunk of splitMessage(text, 3800)) await this.call('sendMessage', { chat_id: chatId, text: chunk, ...(reply_markup ? { reply_markup } : {}) });
  }

  private async answerCallback(callbackQueryId: string, text: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    if (!this.token) throw new Error('Telegram bot token is not configured');
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json() as TelegramResponse<T>;
    if (!response.ok || !payload.ok) throw new Error(`Telegram ${method} failed: ${payload.description || response.status}`);
    return payload.result;
  }
}

function splitMessage(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += limit) chunks.push(text.slice(start, start + limit));
  return chunks;
}

function helpText(): string {
  return ['/start /ayuda — guía', '/configurar — conexiones y límites', '/nuevo_libro <título> — crear proyecto', '/ideas [contexto] — propuestas persistidas', '/proyectos — listar libros', '/estado <project_id>', '/agentes — once perfiles', '/tareas <project_id>', '/costos — presupuesto y consumo', '/aprobaciones — decisiones pendientes', '/publicar <release_id> — preparar asistencia, sin publicar externamente', '/redes /calendario — marketing', '/pausar <project_id> /continuar <project_id>', '/cancelar <task_id>', 'Adjuntos: caption = project_id; máximo 20 MB'].join('\n');
}

function formatProjects(projects: ProjectRecord[]): string {
  return projects.length ? projects.map((project) => `${project.id} · ${project.title} · ${project.stage}${project.paused ? ' · pausado' : ''}`).join('\n') : 'No hay proyectos.';
}

function formatProjectStatus(runtime: EditorialRuntime, projectId: string): string {
  const project = runtime.repo.getProject(projectId);
  if (!project) return 'Indica un project_id válido.';
  const tasks = runtime.repo.listTasks(project.id);
  const open = tasks.filter((task) => !['completed', 'cancelled'].includes(task.state)).length;
  return `${project.title}\nID: ${project.id}\nEtapa: ${project.stage}\nTareas abiertas: ${open}/${tasks.length}\nPróximo paso: ${tasks.find((task) => task.state !== 'completed' && task.state !== 'cancelled')?.contract.objective || 'Revisar decisiones pendientes.'}`;
}

function formatTasks(runtime: EditorialRuntime, projectId: string): string {
  const tasks = runtime.repo.listTasks(projectId || undefined);
  return tasks.length ? tasks.map((task) => `${task.contract.taskId} · ${task.contract.roleId} · ${task.state} · intentos ${task.attempts}`).join('\n') : 'No hay tareas.';
}

function formatCosts(runtime: EditorialRuntime): string {
  const costs = runtime.snapshot().costs;
  return `Estimado: $${costs.estimatedUsd.toFixed(4)}\nObservado: $${costs.observedUsd.toFixed(4)}\nLímite: ${costs.budgetUsd === undefined ? 'no configurado' : `$${costs.budgetUsd.toFixed(2)}`}`;
}

function runtimeSnapshotProfiles(): Record<string, { id: RoleId; displayName: string }> {
  return Object.fromEntries(Object.values(['editorial-director', 'researcher', 'rights-manager', 'writer', 'development-editor', 'proofreader', 'art-director', 'layout-kdp', 'independent-auditor', 'kdp-publisher', 'marketing-analyst'] as RoleId[]).map((role) => { const profile = profileFor(role); return [role, { id: profile.id, displayName: profile.displayName }]; }));
}

function redact(value: string): string {
  return value.replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot<redacted>');
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
