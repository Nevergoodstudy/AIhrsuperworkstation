import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openDatabase } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { id, token, digest, hashPassword } from '../server/security.mjs';
import { createBackup, verifyBackup, restoreBackup } from '../scripts/backup.mjs';

const origin = 'http://localhost:5173';
const password = 'Migration-test-only-password!2026';
const historicalTime = '2026-11-01T09:10:11.000Z';
const future = '2099-12-31T23:59:59.000Z';

// Frozen v3 disk format. Keep independent of the current migration code and Git
// HEAD so this still exercises a real old database after these changes commit.
const schemaV3 = `
  PRAGMA foreign_keys=ON;
  PRAGMA journal_mode=WAL;
  CREATE TABLE migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
  CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE COLLATE NOCASE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','hr','department')), department TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
  CREATE TABLE sessions(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
  CREATE TABLE jobs(id TEXT PRIMARY KEY, title TEXT NOT NULL, department TEXT NOT NULL, location TEXT NOT NULL, description TEXT NOT NULL, requirements TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('招聘中','暂停','已关闭')), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE candidates(id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, stage TEXT NOT NULL, resume_text TEXT NOT NULL, file_key TEXT, file_name TEXT, skills TEXT NOT NULL, analysis TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, consent_at TEXT);
  CREATE TABLE questions(id TEXT PRIMARY KEY, title TEXT NOT NULL, competency TEXT NOT NULL, type TEXT NOT NULL, level TEXT NOT NULL, minutes INTEGER NOT NULL, rubric TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE assessments(id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), name TEXT NOT NULL, duration INTEGER NOT NULL, question_ids TEXT NOT NULL, allow_ai INTEGER NOT NULL, randomize INTEGER NOT NULL, record_switch INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE exams(id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE, assessment_id TEXT NOT NULL REFERENCES assessments(id), name TEXT NOT NULL, questions TEXT NOT NULL, duration INTEGER NOT NULL, allow_ai INTEGER NOT NULL, record_switch INTEGER NOT NULL, token_hash TEXT UNIQUE NOT NULL, status TEXT NOT NULL CHECK(status IN ('invited','in_progress','submitted','expired','revoked')), expires_at TEXT NOT NULL, started_at TEXT, deadline_at TEXT, submitted_at TEXT, answers TEXT NOT NULL DEFAULT '{}', revision INTEGER NOT NULL DEFAULT 0, used_ai INTEGER NOT NULL DEFAULT 0, consent_at TEXT, feedback TEXT, mail_status TEXT NOT NULL DEFAULT 'not_sent', created_at TEXT NOT NULL);
  CREATE UNIQUE INDEX one_active_exam ON exams(candidate_id) WHERE status IN ('invited','in_progress');
  CREATE TABLE portal_sessions(hash TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
  CREATE TABLE exam_events(id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE, created_at TEXT NOT NULL);
  CREATE TABLE reviews(id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), ratings TEXT NOT NULL, recommendation TEXT NOT NULL, note TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, UNIQUE(exam_id,user_id));
  CREATE TABLE audit(id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL, action TEXT NOT NULL, resource_id TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE file_cleanup(file_key TEXT PRIMARY KEY);
  CREATE TABLE rate_limits(key TEXT PRIMARY KEY, hits INTEGER NOT NULL, reset_at INTEGER NOT NULL);
  CREATE INDEX candidates_job ON candidates(job_id);
  CREATE INDEX exams_candidate ON exams(candidate_id);
  CREATE INDEX portal_expiry ON portal_sessions(expires_at);
  CREATE INDEX sessions_expiry ON sessions(expires_at);
`;

const tables = ['users', 'jobs', 'candidates', 'questions', 'assessments', 'exams', 'sessions', 'portal_sessions', 'exam_events', 'reviews', 'audit', 'migrations'];
const snapshot = db => Object.fromEntries(tables.map(table => [table, db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all().map(row => ({ ...row }))]));
function assertPreserved(db, before, { clearedSessions = false } = {}) {
  for (const table of tables) {
    if (table === 'migrations' || (clearedSessions && ['sessions', 'portal_sessions'].includes(table))) continue;
    const current = db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all();
    const oldColumns = before[table][0] && Object.keys(before[table][0]);
    assert.equal(current.length, before[table].length, table + ' row count');
    if (oldColumns) assert.deepEqual(current.map(row => Object.fromEntries(oldColumns.map(key => [key, row[key]]))), before[table], table + ' existing values');
  }
  assert.equal(db.prepare('SELECT stage_exam_id FROM candidates').get().stage_exam_id, null);
  assert.equal(db.prepare('SELECT prior_stage FROM exams').get().prior_stage, null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM candidate_events').get().n, 0, '不能根据 updated_at 伪造历史阶段事件');
  assert.equal(db.prepare('SELECT count(*) AS n FROM analysis_runs').get().n, 0, '不能把旧分析伪造为有来源的运行');
  assert.deepEqual(db.prepare('SELECT * FROM migrations WHERE version<=3 ORDER BY version').all().map(row => ({ ...row })), before.migrations);
  assert.equal(db.prepare('SELECT count(*) AS n FROM migrations WHERE version=4').get().n, 1);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map(row => Object.values(row)[0]), ['ok']);
}

async function createLegacy(dataDir) {
  await mkdir(path.join(dataDir, 'resumes'), { recursive: true });
  const keys = { user: id(), job: id(), candidate: id(), question: id(), assessment: id(), exam: id(), file: id() };
  const raw = { staff: token(), portal: token(), invitation: token() };
  const resume = '我用 Node.js 和 SQL 开发过可靠的订单处理流程。';
  const analysis = JSON.stringify({ method: 'ai', label: 'AI 证据覆盖（仅辅助筛选）', model: 'historical-model', score: 50, summary: '旧版本生成的历史概述', evidence: [{ requirement: 'Node.js', quote: resume, matched: true }, { requirement: 'Python', quote: '', matched: false }], analyzedAt: historicalTime });
  const questions = JSON.stringify([{ id: keys.question, title: '怎样避免重复订单？', competency: '可靠性', type: '实操题', minutes: 20, rubric: '核查幂等及失败恢复' }]);
  const answers = { [keys.question]: '使用数据库唯一约束、幂等键与事务。\n失败后可以重试。' };
  const hash = await hashPassword(password);
  const db = new DatabaseSync(path.join(dataDir, 'talent.sqlite'));
  try {
    db.exec(schemaV3);
    for (const version of [1, 2, 3]) db.prepare('INSERT INTO migrations VALUES(?,?)').run(version, historicalTime);
    db.prepare('INSERT INTO users(id,name,email,password_hash,role,department,must_change,created_at) VALUES(?,?,?,?,?,?,0,?)').run(keys.user, '迁移验收 HR', 'migration@example.test', hash, 'hr', '', historicalTime);
    db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?)').run(keys.job, '历史岗位', '技术部', '上海', '历史岗位描述', JSON.stringify(['Node.js', 'Python']), '招聘中', 4, historicalTime, historicalTime);
    db.prepare('INSERT INTO candidates VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(keys.candidate, keys.job, '历史候选人', 'legacy@example.test', '13800138000', '测评中', resume, keys.file, '历史简历.txt', JSON.stringify(['Node.js']), analysis, 7, historicalTime, historicalTime, historicalTime);
    db.prepare('INSERT INTO questions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(keys.question, '怎样避免重复订单？', '可靠性', '实操题', '进阶', 20, '核查幂等及失败恢复', 1, historicalTime, historicalTime, 2);
    db.prepare('INSERT INTO assessments VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(keys.assessment, keys.job, '历史方案', 60, JSON.stringify([keys.question]), 0, 0, 1, historicalTime, historicalTime, 3);
    db.prepare('INSERT INTO exams(id,candidate_id,assessment_id,name,questions,duration,allow_ai,record_switch,token_hash,status,expires_at,started_at,deadline_at,answers,revision,used_ai,consent_at,mail_status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(keys.exam, keys.candidate, keys.assessment, '历史测评', questions, 60, 0, 1, digest(raw.invitation), 'in_progress', future, historicalTime, future, JSON.stringify(answers), 3, 1, historicalTime, 'accepted', historicalTime);
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(raw.staff), keys.user, future);
    db.prepare('INSERT INTO portal_sessions VALUES(?,?,?)').run(digest(raw.portal), keys.exam, future);
    db.prepare('INSERT INTO exam_events VALUES(?,?,?)').run(id(), keys.exam, historicalTime);
    db.prepare('INSERT INTO audit(actor_id,action,resource_id,created_at) VALUES(?,?,?,?)').run(keys.user, 'exam.invite', keys.exam, historicalTime);
    assert.deepEqual(db.prepare('SELECT version FROM migrations ORDER BY version').all().map(row => row.version), [1, 2, 3]);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('candidate_events','analysis_runs')").get().n, 0);
    assert.equal(db.prepare('PRAGMA table_info(candidates)').all().some(column => column.name === 'stage_exam_id'), false);
    assert.equal(db.prepare('PRAGMA table_info(exams)').all().some(column => column.name === 'prior_stage'), false);
    await writeFile(path.join(dataDir, 'resumes', keys.file), resume, { mode: 0o600 });
    return { keys, raw, resume, analysis, answers, before: snapshot(db) };
  } finally { db.close(); }
}

async function startCurrent(dataDir) {
  const service = createApp({ dataDir, env: 'test', appUrl: origin, aiKey: '', aiModel: '', smtpUrl: '', mailFrom: '' });
  const server = service.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  async function call(route, { method = 'GET', body, cookie = '', examId } = {}) {
    const response = await fetch(base + route, { method, headers: { Origin: origin, 'X-Requested-With': 'TalentDesk', ...(cookie ? { Cookie: cookie } : {}), ...(examId ? { 'X-Exam-Id': examId } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  return { service, call, async stop() { await new Promise(resolve => server.close(resolve)); service.close(); } };
}

test('真实 v3 库迁移到 v4：历史值保持、无伪造归属和事件、重复打开幂等', { timeout: 20000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'talent-migration-v3-'));
  let current;
  t.after(async () => { try { await current?.stop(); } finally { await rm(root, { recursive: true, force: true }); } });
  const legacy = await createLegacy(root);
  const migrated = openDatabase(root);
  assertPreserved(migrated, legacy.before);
  const afterFirst = snapshot(migrated);
  migrated.close();
  for (let count = 0; count < 2; count++) {
    const reopened = openDatabase(root);
    try { assertPreserved(reopened, legacy.before); assert.deepEqual(snapshot(reopened), afterFirst); }
    finally { reopened.close(); }
  }
  current = await startCurrent(root);
  const { service, call } = current;
  assert.equal((await call('/api/ready')).status, 200);
  const detail = await call('/api/candidates/' + legacy.keys.candidate, { cookie: 'td_session=' + legacy.raw.staff });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.analysis.stale, true);
  assert.match(detail.body.analysis.staleReason, /历史|版本/);
  assert.equal(detail.body.analysis.summaryNeedsReview, true);
  assert.deepEqual(detail.body.skills, []);
  const exam = await call('/api/portal/me', { cookie: 'td_portal=' + legacy.raw.portal, examId: legacy.keys.exam });
  assert.equal(exam.status, 200);
  assert.deepEqual(exam.body.answers, legacy.answers);
  assert.equal(exam.body.revision, 3);
  assert.equal(exam.body.deadlineAt, future);
  assertPreserved(service.db, legacy.before);
});

test('v3 备份恢复至新目录后，新版本可以迁移启动且旧会话失效', { timeout: 20000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'talent-migration-restore-'));
  let current;
  t.after(async () => { try { await current?.stop(); } finally { await rm(root, { recursive: true, force: true }); } });
  const source = path.join(root, 'legacy'), target = path.join(root, 'restored');
  const legacy = await createLegacy(source);
  const backup = await createBackup(source, path.join(root, 'backups'));
  assert.equal((await verifyBackup(backup)).files.length, 2);
  const oldSnapshot = new DatabaseSync(path.join(backup, 'talent.sqlite'), { readOnly: true });
  try { assert.deepEqual(oldSnapshot.prepare('SELECT version FROM migrations ORDER BY version').all().map(row => row.version), [1, 2, 3]); }
  finally { oldSnapshot.close(); }
  await restoreBackup(backup, target);
  assert.equal(await readFile(path.join(target, 'resumes', legacy.keys.file), 'utf8'), legacy.resume);
  current = await startCurrent(target);
  const { service, call } = current;
  assert.equal((await call('/api/ready')).body.status, 'ready');
  assertPreserved(service.db, legacy.before, { clearedSessions: true });
  assert.equal(service.db.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
  assert.equal(service.db.prepare('SELECT count(*) AS n FROM portal_sessions').get().n, 0);
  assert.equal((await call('/api/auth/me', { cookie: 'td_session=' + legacy.raw.staff })).status, 401);
  assert.equal((await call('/api/portal/me', { cookie: 'td_portal=' + legacy.raw.portal, examId: legacy.keys.exam })).status, 401);
  const login = await call('/api/auth/login', { method: 'POST', body: { email: 'migration@example.test', password } });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const detail = await call('/api/candidates/' + legacy.keys.candidate, { cookie });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.analysis.stale, true);
  assert.equal(detail.body.version, 7);
  const redeem = await call('/api/portal/redeem', { method: 'POST', body: { token: legacy.raw.invitation } });
  assert.equal(redeem.status, 200);
  assert.equal(redeem.body.id, legacy.keys.exam);
  assert.deepEqual(redeem.body.answers, legacy.answers);
  assert.equal(redeem.body.revision, 3);
  assert.equal(redeem.body.startedAt, historicalTime);
  assert.equal(redeem.body.deadlineAt, future);
});
