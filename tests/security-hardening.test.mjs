import test from 'node:test';
import assert from 'node:assert/strict';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { digest } from '../server/security.mjs';
import { fixture, invite, password, setupBusiness } from './helpers.mjs';

const dayMs = 86400000;

test('已提交答卷的会话与邀请共用访问截止时间', async t => {
  const f = await fixture();
  t.after(() => f.cleanup());
  const hr = f.client(), candidate = f.client(), nearExpiry = f.client();
  assert.equal((await hr.login()).status, 200);
  const business = await setupBusiness(hr), link = await invite(hr, business);
  const redemption = { token: link.token };
  assert.equal((await candidate.call('/api/portal/redeem', 'POST', redemption)).status, 200);
  assert.equal((await candidate.call('/api/portal/start', 'POST', { consent: true })).status, 200);
  const answers = { [business.questionId]: '合成答卷' };
  assert.equal((await candidate.call('/api/portal/submit', 'POST', { revision: 0, answers, usedAI: false })).status, 200);

  const setSubmittedAt = f.db.prepare('UPDATE exams SET submitted_at=? WHERE id=?');
  const submittedAt = Date.now() - 29 * dayMs;
  setSubmittedAt.run(new Date(submittedAt).toISOString(), link.id);
  const granted = await nearExpiry.call('/api/portal/redeem', 'POST', redemption);
  assert.equal(granted.status, 200);
  const raw = granted.headers.getSetCookie()[0].split(';')[0].slice('td_portal='.length);
  const session = f.db.prepare('SELECT expires_at FROM portal_sessions WHERE hash=?').get(digest(raw));
  assert.equal(session.expires_at, new Date(submittedAt + 30 * dayMs).toISOString());
  assert.deepEqual((await nearExpiry.call('/api/portal/me')).body.answers, answers);

  setSubmittedAt.run(new Date(Date.now() - 31 * dayMs).toISOString(), link.id);
  assert.equal((await candidate.call('/api/portal/me')).status, 401);
  assert.equal((await nearExpiry.call('/api/portal/redeem', 'POST', redemption)).status, 410);
  setSubmittedAt.run(null, link.id);
  assert.equal((await candidate.call('/api/portal/me')).status, 401);
});

test('门户按已核验的会话处理当前测评，后台维护其他测评', async t => {
  const f = await fixture();
  t.after(() => f.cleanup());
  const hr = f.client(), candidate = f.client();
  assert.equal((await hr.login()).status, 200);
  const current = await invite(hr, await setupBusiness(hr));
  const other = await invite(hr, await setupBusiness(hr));
  assert.equal((await candidate.call('/api/portal/redeem', 'POST', { token: current.token })).status, 200);
  const past = new Date(Date.now() - dayMs).toISOString();
  const expire = f.db.prepare('UPDATE exams SET expires_at=? WHERE id=?');
  const status = f.db.prepare('SELECT status FROM exams WHERE id=?');
  expire.run(past, current.id);
  expire.run(past, other.id);

  const anonymous = f.client();
  assert.equal((await anonymous.call('/api/portal/me', 'GET', undefined, { 'X-Exam-Id': current.id })).status, 401);
  assert.equal((await anonymous.call('/api/portal/redeem', 'POST', { token: 'A'.repeat(43) })).status, 410);
  assert.equal(status.get(current.id).status, 'invited');
  assert.equal(status.get(other.id).status, 'invited');
  assert.equal((await candidate.call('/api/portal/me')).status, 401);
  assert.equal(status.get(current.id).status, 'expired');
  assert.equal(status.get(other.id).status, 'invited');
  f.sweep();
  assert.equal(status.get(other.id).status, 'expired');
});

test('登录限额按来源隔离，同一来源仍受防爆破限制', async t => {
  const f = await fixture({ trustProxy: true });
  t.after(() => f.cleanup());
  const login = f.client();
  const email = f.accounts.hr.email;
  const limitedSource = '192.0.2.40';
  const key = 'login-ip-account:' + digest(limitedSource + ':' + email);
  const insert = f.db.prepare('INSERT INTO rate_limits VALUES(?,?,?)');
  insert.run(key, 12, Date.now() + 60000);
  const body = { email, password };
  assert.equal((await login.call('/api/auth/login', 'POST', { ...body, email: email.toUpperCase() }, { 'X-Forwarded-For': limitedSource })).status, 429);
  assert.equal((await login.call('/api/auth/login', 'POST', body, { 'X-Forwarded-For': '192.0.2.41' })).status, 200);

  f.db.prepare('UPDATE rate_limits SET reset_at=? WHERE key=?').run(Date.now() - 1000, key);
  assert.equal((await login.call('/api/auth/login', 'POST', body, { 'X-Forwarded-For': limitedSource })).status, 200);
  assert.equal(f.db.prepare('SELECT hits FROM rate_limits WHERE key=?').get(key).hits, 1);
});

test('导入在写入原件期间失去员工授权时取消提交并清理原件', { timeout: 5000 }, async t => {
  const f = await fixture();
  t.after(() => f.cleanup());
  const hr = f.client(), admin = f.client();
  assert.equal((await hr.login()).status, 200);
  assert.equal((await admin.login('admin')).status, 200);
  const business = await setupBusiness(hr);
  const originalWrite = fs.writeFile;
  const written = Promise.withResolvers();
  const resumeCommit = Promise.withResolvers();
  const write = t.mock.method(fs, 'writeFile', async (target, ...args) => {
    await originalWrite(target, ...args);
    if (path.dirname(target) !== path.join(f.dataDir, 'resumes')) return;
    written.resolve();
    await resumeCommit.promise;
  });
  syncBuiltinESMExports();
  const form = new FormData();
  for (const [key, value] of Object.entries({
    jobId: business.jobId, name: '合成导入候选人', email: '', phone: '', consent: 'true'
  })) form.append(key, value);
  form.append('resume', new Blob(['Synthetic experience with Node.js and SQL.']), 'synthetic.txt');
  try {
    const importing = hr.call('/api/candidates/import', 'POST', form);
    await Promise.race([written.promise, importing.then(result => assert.fail('写入原件前提前返回 ' + result.status))]);
    try {
      assert.equal((await admin.call('/api/admin/users/' + f.accounts.hr.id, 'PATCH', { active: false })).status, 200);
    } finally {
      resumeCommit.resolve();
    }
    assert.equal((await importing).status, 403);
    assert.equal(f.db.prepare('SELECT count(*) AS count FROM candidates').get().count, 1);
    assert.equal(f.db.prepare("SELECT count(*) AS count FROM audit WHERE action='candidate.create'").get().count, 1);
    assert.deepEqual(await fs.readdir(path.join(f.dataDir, 'resumes')), []);
  } finally {
    resumeCommit.resolve();
    write.mock.restore();
    syncBuiltinESMExports();
  }
});
