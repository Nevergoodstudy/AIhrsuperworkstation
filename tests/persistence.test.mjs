import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/db.mjs';
import { id, now, hashPassword } from '../server/security.mjs';
import { origin, password, setupBusiness, invite } from './helpers.mjs';

test('真实服务进程重启后，账号会话、简历原件和已保存答卷均可继续使用', { timeout: 30000 }, async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'talent-restart-'));
  let processHandle, base;
  async function stop() {
    if (!processHandle || processHandle.exitCode !== null || processHandle.signalCode !== null) return;
    const child = processHandle;
    const exited = once(child, 'exit');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.kill('SIGTERM');
    try { const [code, signal] = await exited; assert.equal(code, 0, '服务应正常退出：' + signal); } finally { clearTimeout(timer); }
  }
  t.after(async () => { try { await stop(); } finally { await rm(dataDir, { recursive: true, force: true }); } });
  const db = openDatabase(dataDir);
  db.prepare('INSERT INTO users(id,name,email,password_hash,role,department,must_change,created_at) VALUES(?,?,?,?,?,?,0,?)').run(id(), '重启验收管理员', 'restart@example.test', await hashPassword(password), 'admin', '', now());
  db.close();
  async function start() {
    processHandle = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test', DATA_DIR: dataDir, HOST: '127.0.0.1', PORT: '0', APP_URL: origin, AI_API_KEY: '', AI_MODEL: '', SMTP_URL: '', MAIL_FROM: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const child = processHandle;
    base = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('服务启动超时：' + output)), 10000);
      const failed = error => { clearTimeout(timer); reject(error); };
      child.once('error', failed);
      child.once('exit', code => failed(new Error('服务提前退出：' + code + ' ' + output)));
      child.stdout.on('data', chunk => { output += chunk; const match = output.match(/Talent Desk listening on 127\.0\.0\.1:(\d+)/); if (match) { clearTimeout(timer); resolve('http://127.0.0.1:' + match[1]); } });
      child.stderr.on('data', chunk => { output += chunk; });
    });
    assert.equal((await fetch(base + '/api/ready')).status, 200);
  }
  function client() {
    const cookies = new Map(); let examId;
    return { async call(route, method = 'GET', body) {
      const response = await fetch(base + route, { method, headers: { Origin: origin, 'X-Requested-With': 'TalentDesk', ...(examId && route.startsWith('/api/portal/') && route !== '/api/portal/redeem' ? { 'X-Exam-Id': examId } : {}), Cookie: [...cookies].map(([key, value]) => key + '=' + value).join('; '), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
      for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(';')[0], split = pair.indexOf('='); cookies.set(pair.slice(0, split), pair.slice(split + 1)); }
      const value = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text();
      if (route === '/api/portal/redeem' && response.ok) examId = value.id;
      return { status: response.status, body: value, headers: response.headers };
    } };
  }
  await start();
  const hr = client(), portal = client();
  assert.equal((await hr.call('/api/auth/login', 'POST', { email: 'restart@example.test', password })).status, 200);
  const business = await setupBusiness(hr), link = await invite(hr, business);
  const form = new FormData();
  for (const [key, value] of Object.entries({ jobId: business.jobId, name: '重启后原件', email: '', phone: '', consent: 'true' })) form.append(key, value);
  const resume = 'Node.js and SQL projects survive a real server restart.';
  form.append('resume', new Blob([resume]), 'restart.txt');
  const uploaded = await hr.call('/api/candidates/import', 'POST', form);
  assert.equal(uploaded.status, 201);
  assert.equal((await portal.call('/api/portal/redeem', 'POST', { token: link.token })).status, 200);
  const started = await portal.call('/api/portal/start', 'POST', { consent: true });
  const answers = { [business.questionId]: '重启前保存的订单幂等与事务方案。' };
  assert.equal((await portal.call('/api/portal/answers', 'PUT', { revision: 0, answers, usedAI: false })).status, 200);
  const ledger = openDatabase(dataDir);
  const runId = id();
  ledger.prepare("INSERT INTO analysis_runs(id,candidate_id,job_id,candidate_version,job_version,resume_hash,model,prompt_version,requested_by,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'running',?)").run(runId, business.candidateId, business.jobId, 3, 1, 'synthetic-hash', 'test-model', 'test-prompt', 'test-actor', now());
  // Other database users (for example an admin CLI) must not interrupt live requests.
  const reader = openDatabase(dataDir);
  assert.equal(reader.prepare('SELECT status FROM analysis_runs WHERE id=?').get(runId).status, 'running'); reader.close(); ledger.close();
  await stop();
  await start();
  const recoveredLedger = openDatabase(dataDir);
  const interrupted = recoveredLedger.prepare('SELECT * FROM analysis_runs WHERE id=?').get(runId);
  assert.equal(interrupted.status, 'failed'); assert.match(interrupted.reason, /进程中断/); assert.ok(interrupted.completed_at); recoveredLedger.close();
  assert.equal((await hr.call('/api/auth/me')).body.user.email, 'restart@example.test');
  const workspace = await hr.call('/api/workspace');
  assert.equal(workspace.status, 200);
  assert.equal(workspace.body.candidates.length, 2);
  assert.equal((await hr.call('/api/candidates/' + uploaded.body.id + '/resume')).body, resume);
  const reloaded = await portal.call('/api/portal/me');
  assert.equal(reloaded.status, 200);
  assert.equal(reloaded.body.deadlineAt, started.body.deadlineAt);
  assert.equal(reloaded.body.revision, 1);
  assert.deepEqual(reloaded.body.answers, answers);
  assert.equal((await portal.call('/api/portal/submit', 'POST', { revision: 1, answers, usedAI: false })).body.status, 'submitted');
  assert.equal((await hr.call('/api/exams/' + link.id)).body.answers[business.questionId], answers[business.questionId]);
});
