import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type DbValue = string | number | bigint | null | Uint8Array;

const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);` +
    `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      stage TEXT NOT NULL,
      paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
      brief_json TEXT NOT NULL,
      active_revision_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );` +
    `CREATE TABLE IF NOT EXISTS revisions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      parent_id TEXT REFERENCES revisions(id),
      content_hash TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );` +
    `CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      edition_id TEXT,
      role_id TEXT NOT NULL,
      state TEXT NOT NULL,
      contract_json TEXT NOT NULL,
      result_json TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL,
      generation INTEGER NOT NULL DEFAULT 0,
      lease_owner TEXT,
      lease_until TEXT,
      heartbeat_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );` +
    `CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      depends_on TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, depends_on),
      CHECK (task_id <> depends_on)
    );` +
    `CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      profile_version TEXT NOT NULL,
      office_worker_id TEXT,
      office_floor_id TEXT,
      status TEXT NOT NULL,
      action_summary TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );` +
    `CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      edition_id TEXT,
      task_id TEXT REFERENCES tasks(id),
      revision_id TEXT REFERENCES revisions(id),
      type TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );` +
    `CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      url TEXT,
      identifier TEXT,
      title TEXT,
      observed_at TEXT NOT NULL,
      notes TEXT,
      claims_json TEXT NOT NULL
    );` +
    `CREATE TABLE IF NOT EXISTS rights_records (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      artifact_id TEXT REFERENCES artifacts(id),
      origin TEXT NOT NULL,
      creator TEXT,
      license TEXT,
      evidence TEXT,
      ai_status TEXT NOT NULL,
      conditions TEXT,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );` +
    `CREATE TABLE IF NOT EXISTS findings (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES tasks(id),
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      location TEXT,
      resolution TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );` +
    `CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      subject_hash TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      state TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      used_at TEXT
    );` +
    `CREATE TABLE IF NOT EXISTS releases (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      manifest_hash TEXT NOT NULL UNIQUE,
      artifact_ids_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      audit_status TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL
    );` +
    `CREATE TABLE IF NOT EXISTS cost_events (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      provider TEXT NOT NULL,
      estimated_usd REAL NOT NULL DEFAULT 0,
      observed_usd REAL NOT NULL DEFAULT 0,
      reserved_usd REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );` +
    `CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      generation INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );` +
    `CREATE TABLE IF NOT EXISTS telegram_updates (
      update_id INTEGER PRIMARY KEY,
      received_at TEXT NOT NULL
    );` +
    `CREATE TABLE IF NOT EXISTS social_accounts (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      account_label TEXT NOT NULL,
      token_ref TEXT,
      capabilities_json TEXT NOT NULL,
      status TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );` +
    `CREATE TABLE IF NOT EXISTS social_posts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      account_id TEXT REFERENCES social_accounts(id),
      content_hash TEXT NOT NULL,
      content_json TEXT NOT NULL,
      scheduled_at TEXT,
      timezone TEXT NOT NULL,
      state TEXT NOT NULL,
      remote_id TEXT,
      remote_url TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(account_id, content_hash, scheduled_at)
    );` +
    `CREATE TABLE IF NOT EXISTS capability_matrix (
      capability TEXT PRIMARY KEY,
      component TEXT NOT NULL,
      state TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      dependency TEXT,
      limitation TEXT,
      checked_at TEXT NOT NULL
    );` +
    `CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      project_id TEXT,
      task_id TEXT,
      subject_hash TEXT,
      detail_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );` +
    `CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state, updated_at);` +
    `CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, updated_at);` +
    `CREATE INDEX IF NOT EXISTS idx_artifacts_project ON artifacts(project_id, created_at);` +
    `CREATE INDEX IF NOT EXISTS idx_findings_project ON findings(project_id, status, severity);`,
];

export class EditorialDatabase {
  readonly db: DatabaseSync;

  constructor(readonly filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filePath);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  checkpoint(): void {
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }

  run(sql: string, ...params: DbValue[]) {
    return this.db.prepare(sql).run(...params);
  }

  get<T extends Record<string, unknown>>(sql: string, ...params: DbValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  all<T extends Record<string, unknown>>(sql: string, ...params: DbValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // Keep the original error; SQLite may already have rolled back after a constraint failure.
      }
      throw error;
    }
  }

  private migrate(): void {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    const current = Number(this.get<{ version: number }>('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')?.version ?? 0);
    for (let i = current; i < MIGRATIONS.length; i += 1) {
      const version = i + 1;
      this.transaction(() => {
        this.db.exec(MIGRATIONS[i]);
        this.run('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)', version, new Date().toISOString());
      });
    }
  }
}

export type { DbValue };
