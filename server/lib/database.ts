import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger("database");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = resolve(process.cwd(), config.database.path);
    mkdirSync(dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    log.info("Database opened", { path: dbPath });
    runMigrations(db);
  }
  return db;
}

function runMigrations(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    database
      .prepare("SELECT id FROM migrations")
      .all()
      .map((r: any) => r.id as string),
  );

  const migrations: Array<{ id: string; sql: string }> = [
    {
      id: "001_initial_schema",
      sql: `
        CREATE TABLE IF NOT EXISTS api_keys (
          id TEXT PRIMARY KEY,
          alias TEXT NOT NULL,
          secret_ciphertext TEXT NOT NULL,
          fingerprint TEXT NOT NULL UNIQUE,
          key_type TEXT NOT NULL DEFAULT 'standard',
          region TEXT NOT NULL DEFAULT 'ap-southeast-1',
          workspace_id TEXT,
          base_url TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'unknown',
          enabled INTEGER NOT NULL DEFAULT 1,
          cooldown_until TEXT,
          last_validated_at TEXT,
          last_error_code TEXT,
          last_error_message TEXT,
          consecutive_failures INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS key_groups (
          key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
          group_id TEXT NOT NULL,
          PRIMARY KEY (key_id, group_id)
        );

        CREATE TABLE IF NOT EXISTS model_groups (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          aliases TEXT NOT NULL DEFAULT '[]',
          candidates TEXT NOT NULL DEFAULT '[]',
          strategy TEXT NOT NULL DEFAULT 'round_robin',
          weights TEXT NOT NULL DEFAULT '{}',
          fallback_group_ids TEXT NOT NULL DEFAULT '[]',
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS quota_snapshots (
          id TEXT PRIMARY KEY,
          api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
          upstream_model_id TEXT,
          rpm_limit INTEGER,
          rpm_remaining INTEGER,
          tpm_limit INTEGER,
          tpm_remaining INTEGER,
          daily_limit INTEGER,
          daily_remaining INTEGER,
          source TEXT NOT NULL DEFAULT 'unknown',
          observed_at TEXT NOT NULL DEFAULT (datetime('now')),
          expires_at TEXT
        );

        CREATE TABLE IF NOT EXISTS request_logs (
          id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL UNIQUE,
          timestamp TEXT NOT NULL DEFAULT (datetime('now')),
          client_ip TEXT,
          requested_model TEXT NOT NULL,
          resolved_group_id TEXT,
          upstream_model_id TEXT,
          api_key_id TEXT,
          status_code INTEGER NOT NULL,
          error_code TEXT,
          latency_ms INTEGER NOT NULL,
          ttft_ms INTEGER,
          prompt_tokens INTEGER,
          completion_tokens INTEGER,
          streaming INTEGER NOT NULL DEFAULT 0,
          retry_count INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_request_logs_timestamp ON request_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_request_logs_request_id ON request_logs(request_id);
        CREATE INDEX IF NOT EXISTS idx_quota_snapshots_key ON quota_snapshots(api_key_id);
        CREATE INDEX IF NOT EXISTS idx_key_groups_group ON key_groups(group_id);
      `,
    },
    {
      id: "002_model_availability",
      sql: `
        CREATE TABLE IF NOT EXISTS model_availability (
          api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
          upstream_model_id TEXT NOT NULL,
          available INTEGER NOT NULL DEFAULT 1,
          error_code TEXT,
          error_message TEXT,
          last_checked_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (api_key_id, upstream_model_id)
        );

        CREATE INDEX IF NOT EXISTS idx_model_availability_key ON model_availability(api_key_id);
      `,
    },
    {
      id: "003_health_checks",
      sql: `
        CREATE TABLE IF NOT EXISTS health_checks (
          id TEXT PRIMARY KEY,
          api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
          upstream_model_id TEXT NOT NULL,
          success INTEGER NOT NULL,
          status_code INTEGER,
          error_code TEXT,
          error_message TEXT,
          latency_ms INTEGER,
          checked_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_health_checks_key ON health_checks(api_key_id);
        CREATE INDEX IF NOT EXISTS idx_health_checks_checked_at ON health_checks(checked_at);
      `,
    },
    {
      id: "004_client_keys_usage_trials",
      sql: `
        CREATE TABLE IF NOT EXISTS client_keys (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          key_hash TEXT NOT NULL UNIQUE,
          key_prefix TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          rpm_limit INTEGER,
          daily_request_limit INTEGER,
          daily_token_budget INTEGER,
          allowed_group_ids TEXT NOT NULL DEFAULT '[]',
          total_requests INTEGER NOT NULL DEFAULT 0,
          total_tokens INTEGER NOT NULL DEFAULT 0,
          total_cost_usd REAL NOT NULL DEFAULT 0,
          last_used_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS usage_daily (
          date TEXT NOT NULL,
          client_key_id TEXT NOT NULL,
          group_id TEXT,
          model TEXT NOT NULL,
          requests INTEGER NOT NULL DEFAULT 0,
          errors INTEGER NOT NULL DEFAULT 0,
          prompt_tokens INTEGER NOT NULL DEFAULT 0,
          completion_tokens INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL NOT NULL DEFAULT 0,
          PRIMARY KEY (date, client_key_id, group_id, model)
        );

        CREATE INDEX IF NOT EXISTS idx_usage_daily_date ON usage_daily(date);
        CREATE INDEX IF NOT EXISTS idx_usage_daily_key ON usage_daily(client_key_id);

        CREATE TABLE IF NOT EXISTS trial_quotas (
          api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
          model TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'tokens',
          limit_amount REAL NOT NULL,
          used REAL NOT NULL DEFAULT 0,
          expires_at TEXT,
          source TEXT NOT NULL DEFAULT 'preset',
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (api_key_id, model)
        );

        CREATE INDEX IF NOT EXISTS idx_trial_quotas_model ON trial_quotas(model);
      `,
    },
    {
      id: "005_usage_daily_group_sentinel",
      sql: `
        -- SQLite treats NULLs as distinct PRIMARY KEY values, so groupless
        -- traffic used to fork a fresh usage_daily row per request. Migrate to
        -- a non-null sentinel ('' == groupless) and collapse any existing forks.
        CREATE TABLE usage_daily_2026_08 (
          date TEXT NOT NULL,
          client_key_id TEXT NOT NULL,
          group_id TEXT NOT NULL DEFAULT '',
          model TEXT NOT NULL,
          requests INTEGER NOT NULL DEFAULT 0,
          errors INTEGER NOT NULL DEFAULT 0,
          prompt_tokens INTEGER NOT NULL DEFAULT 0,
          completion_tokens INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL NOT NULL DEFAULT 0,
          PRIMARY KEY (date, client_key_id, group_id, model)
        );

        INSERT OR REPLACE INTO usage_daily_2026_08 (
          date, client_key_id, group_id, model,
          requests, errors, prompt_tokens, completion_tokens, cost_usd
        )
        SELECT
          date, client_key_id, COALESCE(group_id, '') group_id, model,
          SUM(requests) requests, SUM(errors) errors,
          SUM(prompt_tokens) prompt_tokens, SUM(completion_tokens) completion_tokens,
          SUM(cost_usd) cost_usd
        FROM usage_daily
        GROUP BY date, client_key_id, COALESCE(group_id, ''), model;

        DROP TABLE usage_daily;
        ALTER TABLE usage_daily_2026_08 RENAME TO usage_daily;

        CREATE INDEX IF NOT EXISTS idx_usage_daily_date ON usage_daily(date);
        CREATE INDEX IF NOT EXISTS idx_usage_daily_key ON usage_daily(client_key_id);
      `,
    },
  ];

  const insertMigration = database.prepare(
    "INSERT INTO migrations (id) VALUES (?)",
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    log.info("Running migration", { id: migration.id });
    database.exec(migration.sql);
    insertMigration.run(migration.id);
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    log.info("Database closed");
  }
}
