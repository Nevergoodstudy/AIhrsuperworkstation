import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
export function openDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(path.join(dataDir, 'resumes'), { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, 'talent.sqlite');
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE COLLATE NOCASE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','hr','department')), department TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, title TEXT NOT NULL, department TEXT NOT NULL, location TEXT NOT NULL, description TEXT NOT NULL, requirements TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('招聘中','暂停','已关闭')), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, stage TEXT NOT NULL, resume_text TEXT NOT NULL, file_key TEXT, file_name TEXT, skills TEXT NOT NULL, analysis TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS questions(id TEXT PRIMARY KEY, title TEXT NOT NULL, competency TEXT NOT NULL, type TEXT NOT NULL, level TEXT NOT NULL, minutes INTEGER NOT NULL, rubric TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS assessments(id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), name TEXT NOT NULL, duration INTEGER NOT NULL, question_ids TEXT NOT NULL, allow_ai INTEGER NOT NULL, randomize INTEGER NOT NULL, record_switch INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS exams(id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, assessment_id TEXT NOT NULL REFERENCES assessments(id), name TEXT NOT NULL, questions TEXT NOT NULL, duration INTEGER NOT NULL, allow_ai INTEGER NOT NULL, record_switch INTEGER NOT NULL, token_hash TEXT UNIQUE NOT NULL, status TEXT NOT NULL CHECK(status IN ('invited','in_progress','submitted','expired','revoked')), expires_at TEXT NOT NULL, started_at TEXT, deadline_at TEXT, submitted_at TEXT, answers TEXT NOT NULL DEFAULT '{}', revision INTEGER NOT NULL DEFAULT 0, used_ai INTEGER NOT NULL DEFAULT 0, consent_at TEXT, feedback TEXT, mail_status TEXT NOT NULL DEFAULT 'not_sent', created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_exam ON exams(candidate_id) WHERE status IN ('invited','in_progress');
    CREATE TABLE IF NOT EXISTS portal_sessions(hash TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS exam_events(id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), ratings TEXT NOT NULL, recommendation TEXT NOT NULL, note TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(exam_id,user_id));
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL, action TEXT NOT NULL, resource_id TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS file_cleanup(file_key TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY, hits INTEGER NOT NULL, reset_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS candidates_job ON candidates(job_id);
    CREATE INDEX IF NOT EXISTS exams_candidate ON exams(candidate_id);
    CREATE INDEX IF NOT EXISTS portal_expiry ON portal_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    INSERT OR IGNORE INTO migrations VALUES(1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  `);
  const columns = db.prepare('PRAGMA table_info(candidates)').all();
  if (!columns.some(column => column.name === 'consent_at')) db.exec('ALTER TABLE candidates ADD COLUMN consent_at TEXT');
  db.exec("INSERT OR IGNORE INTO migrations VALUES(2, strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
  for (const table of ['questions', 'assessments', 'reviews']) {
    if (!db.prepare('PRAGMA table_info(' + table + ')').all().some(column => column.name === 'version')) db.exec('ALTER TABLE ' + table + ' ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
  }
  db.exec("INSERT OR IGNORE INTO migrations VALUES(3, strftime('%Y-%m-%dT%H:%M:%fZ','now'))");
  transaction(db, () => {
    if (!db.prepare('PRAGMA table_info(candidates)').all().some(c => c.name === 'stage_exam_id')) db.exec('ALTER TABLE candidates ADD COLUMN stage_exam_id TEXT');
    if (!db.prepare('PRAGMA table_info(exams)').all().some(c => c.name === 'prior_stage')) db.exec('ALTER TABLE exams ADD COLUMN prior_stage TEXT');
    db.exec(`
      CREATE TABLE IF NOT EXISTS candidate_events(id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, exam_id TEXT, from_stage TEXT NOT NULL, to_stage TEXT NOT NULL, source TEXT NOT NULL, actor_id TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS candidate_events_candidate ON candidate_events(candidate_id, created_at);
      CREATE TABLE IF NOT EXISTS analysis_runs(id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, job_id TEXT NOT NULL, candidate_version INTEGER NOT NULL, job_version INTEGER NOT NULL, resume_hash TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL, requested_by TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','completed','superseded','rejected','failed')), reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, completed_at TEXT);
      INSERT OR IGNORE INTO migrations VALUES(4, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
    `);
  });
  return db;
}
export function transaction(db, fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
export const json = (value, fallback = null) => { try { return JSON.parse(value); } catch { return fallback; } };
