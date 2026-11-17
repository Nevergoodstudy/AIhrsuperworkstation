import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fixture, setupBusiness, password } from './helpers.mjs';
import { digest } from '../server/security.mjs';

// The gate exposes the exact asynchronous seam: mutations happen after the model
// received its input and before the response is released, without timing sleeps.
async function controlledAI() {
  const queued = [], entries = [];
  let waiting;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const entry = {
      body,
      respond(content = { summary: '该概述未经人工核验', evidence: [{ requirement: 'Node.js', quote: '我使用 Node.js 开发业务服务。' }] }) {
        if (res.writableEnded || res.destroyed) return;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
      }
    };
    entries.push(entry);
    if (waiting) { const resolve = waiting; waiting = undefined; resolve(entry); }
    else queued.push(entry);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    next: () => queued.length ? Promise.resolve(queued.shift()) : new Promise(resolve => { waiting = resolve; }),
    release: () => entries.forEach(entry => entry.respond()),
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })
  };
}

async function scenario(t) {
  const ai = await controlledAI();
  let f;
  t.after(async () => { ai.release(); if (f) await f.cleanup(); await ai.close(); });
  f = await fixture({ aiBaseUrl: ai.url, aiKey: 'local-test-private-key', aiModel: 'local-test-model' });
  const hr = f.client(), admin = f.client();
  assert.equal((await hr.login()).status, 200);
  assert.equal((await admin.login('admin')).status, 200);
  const business = await setupBusiness(hr);
  const candidate = () => f.db.prepare('SELECT * FROM candidates WHERE id=?').get(business.candidateId);
  const audits = method => f.db.prepare('SELECT count(*) AS n FROM audit WHERE resource_id=? AND action=?').get(business.candidateId, 'candidate.analyze.' + method).n;
  async function begin() {
    const pending = hr.call('/api/candidates/' + business.candidateId + '/analyze', 'POST', { method: 'ai', consent: true });
    const request = await ai.next();
    return { pending, request };
  }
  async function changeJob() {
    const job = (await admin.call('/api/workspace')).body.jobs.find(j => j.id === business.jobId);
    const result = await admin.call('/api/jobs/' + job.id, 'PUT', { ...job, requirements: ['Python'] });
    assert.equal(result.status, 200);
  }
  return { f, ai, hr, admin, business, candidate, audits, begin, changeJob };
}

function assertRun(f, expected) {
  const runs = f.db.prepare('SELECT * FROM analysis_runs').all();
  assert.deepEqual(runs.map(row => row.status).sort(), [...expected].sort());
  return runs;
}

function assertSource(source, s, snapshot, { run = true } = {}) {
  assert.ok(source, '分析必须携带可核对的输入来源');
  assert.equal(source.jobId, s.business.jobId);
  assert.equal(source.jobVersion, 1);
  assert.equal(source.resumeHash, digest(snapshot.resume_text));
  assert.equal(source.candidateVersion, snapshot.version);
  assert.equal(source.requestedBy, s.f.accounts.hr.id);
  assert.ok(Object.hasOwn(source, 'model'));
  assert.equal(typeof source.promptVersion, 'string');
  assert.ok(source.promptVersion.length > 0);
  if (run) assert.ok(source.runId);
}

test('分析来源：创建时的关键词结果也绑定岗位版本和简历摘要', { timeout: 20000 }, async t => {
  const s = await scenario(t), snapshot = s.candidate();
  assertSource(JSON.parse(snapshot.analysis).source, s, snapshot, { run: false });
  const detail = await s.hr.call('/api/candidates/' + snapshot.id);
  assert.equal(detail.body.analysis.stale, false);
});

test('AI 正常完成：运行状态、输入来源与需人工核验的概述一同保存', { timeout: 20000 }, async t => {
  const s = await scenario(t), before = s.candidate();
  const { pending, request } = await s.begin();
  assertRun(s.f, ['running']);
  assert.equal(request.body.model, 'local-test-model');
  request.respond();
  const result = await pending;
  assert.equal(result.status, 200);
  assertSource(result.body.analysis.source, s, before);
  assert.equal(result.body.analysis.source.model, 'local-test-model');
  assert.equal(result.body.analysis.summaryNeedsReview, true);
  const [run] = assertRun(s.f, ['completed']);
  assert.equal(result.body.analysis.source.runId, run.id);
  assert.equal(s.audits('ai'), 1);
  assert.equal(s.candidate().version, before.version + 1);
  assert.doesNotMatch(s.candidate().analysis, /local-test-private-key/);
});

test('AI 等待期间岗位要求变更：旧结果不得覆盖当前资料', { timeout: 20000 }, async t => {
  const s = await scenario(t), before = s.candidate();
  const { pending, request } = await s.begin();
  await s.changeJob();
  request.respond();
  const result = await pending;
  assert.equal(result.status, 409);
  assert.equal(s.candidate().analysis, before.analysis);
  assert.equal(s.candidate().version, before.version);
  assert.equal(s.audits('ai'), 0);
  assertRun(s.f, ['superseded']);
});

for (const action of ['停用', '登出', '重置密码', '会话到期']) {
  test('AI 等待期间' + action + '：写回前重新鉴权并拒绝保存', { timeout: 20000 }, async t => {
    const s = await scenario(t), before = s.candidate();
    const { pending, request } = await s.begin();
    let changed;
    if (action === '停用') changed = await s.admin.call('/api/admin/users/' + s.f.accounts.hr.id, 'PATCH', { active: false });
    if (action === '登出') changed = await s.hr.call('/api/auth/logout', 'POST');
    if (action === '重置密码') changed = await s.admin.call('/api/admin/users/' + s.f.accounts.hr.id, 'PATCH', { password: password + '-reset' });
    if (action === '会话到期') s.f.db.prepare('UPDATE sessions SET expires_at=? WHERE user_id=?').run('2020-01-01T00:00:00.000Z', s.f.accounts.hr.id);
    else assert.equal(changed.status, 200);
    request.respond();
    assert.equal((await pending).status, 403);
    assert.equal(s.candidate().analysis, before.analysis);
    assert.equal(s.candidate().version, before.version);
    assert.equal(s.audits('ai'), 0);
    assertRun(s.f, ['rejected']);
  });
}

test('AI 等待期间候选人被编辑：旧请求不能覆盖新版本', { timeout: 20000 }, async t => {
  const s = await scenario(t), before = s.candidate();
  const { pending, request } = await s.begin();
  const edited = await s.admin.call('/api/candidates/' + before.id, 'PUT', { name: '已由 HR 核实的新姓名', email: before.email, phone: before.phone, stage: before.stage, version: before.version });
  assert.equal(edited.status, 200);
  request.respond();
  assert.equal((await pending).status, 409);
  assert.equal(s.candidate().name, '已由 HR 核实的新姓名');
  assert.equal(s.candidate().analysis, before.analysis);
  assert.equal(s.candidate().version, before.version + 1);
  assert.equal(s.audits('ai'), 0);
  assertRun(s.f, ['superseded']);
});

test('AI 等待期间简历正文漂移：即使版本未递增也不能写回', { timeout: 20000 }, async t => {
  const s = await scenario(t), before = s.candidate();
  const { pending, request } = await s.begin();
  // There is no resume-edit endpoint yet. Simulate an independent importer so
  // this tests the hash guard in addition to the optimistic version guard.
  s.f.db.prepare('UPDATE candidates SET resume_text=? WHERE id=?').run('已核实的新简历正文，仅有 Python 经验。', before.id);
  request.respond();
  assert.equal((await pending).status, 409);
  assert.equal(s.candidate().analysis, before.analysis);
  assert.equal(s.audits('ai'), 0);
  assertRun(s.f, ['superseded']);
});

test('AI 等待期间候选人删除：返回不存在，不复活资料或记录分析成功', { timeout: 20000 }, async t => {
  const s = await scenario(t);
  const { pending, request } = await s.begin();
  assert.equal((await s.admin.call('/api/candidates/' + s.business.candidateId, 'DELETE')).status, 200);
  request.respond();
  assert.equal((await pending).status, 404);
  assert.equal(s.candidate(), undefined);
  assert.equal(s.audits('ai'), 0);
});

test('并发分析：先完成的关键词结果不被随后返回的旧 AI 覆盖', { timeout: 20000 }, async t => {
  const s = await scenario(t);
  const { pending, request } = await s.begin();
  const fresh = await s.hr.call('/api/candidates/' + s.business.candidateId + '/analyze', 'POST', { method: 'keyword' });
  assert.equal(fresh.status, 200);
  const saved = s.candidate();
  request.respond();
  assert.equal((await pending).status, 409);
  assert.equal(s.candidate().analysis, saved.analysis);
  assert.equal(s.candidate().version, saved.version);
  assert.equal(s.audits('keyword'), 1);
  assert.equal(s.audits('ai'), 0);
  assertRun(s.f, ['completed', 'superseded']);
});

test('AI 证据校验失败：保留已有分析并将运行记录为失败', { timeout: 20000 }, async t => {
  const s = await scenario(t), before = s.candidate();
  const { pending, request } = await s.begin();
  request.respond({ summary: '虚构的摘要', evidence: [{ requirement: 'Node.js', quote: '简历没有这段证据' }] });
  assert.equal((await pending).status, 502);
  assert.equal(s.candidate().analysis, before.analysis);
  assert.equal(s.candidate().version, before.version);
  assert.equal(s.audits('ai'), 0);
  assertRun(s.f, ['failed']);
});

test('岗位更新后旧分析在详情、工作区及 CSV 中不得冒充当前结果', { timeout: 20000 }, async t => {
  const s = await scenario(t);
  const old = JSON.parse(s.candidate().analysis);
  assert.equal(old.score, 50);
  await s.changeJob();
  const detail = await s.hr.call('/api/candidates/' + s.business.candidateId);
  assert.equal(detail.body.analysis.stale, true);
  assert.equal(typeof detail.body.analysis.staleReason, 'string');
  assert.ok(detail.body.analysis.staleReason.length > 0);
  assert.deepEqual(detail.body.skills, []);
  const workspace = await s.hr.call('/api/workspace');
  const row = workspace.body.candidates.find(c => c.id === s.business.candidateId);
  assert.equal(row.analysis.stale, true);
  assert.deepEqual(row.skills, []);
  const exported = await s.hr.call('/api/export/candidates');
  assert.equal(exported.status, 200);
  const csvRow = exported.body.split('\n')[1];
  assert.ok(!csvRow.includes('"50"') || /过期|失效|需重新分析|版本未记录/.test(csvRow), 'CSV 旧覆盖率必须省略或明确附带过期状态');
});
