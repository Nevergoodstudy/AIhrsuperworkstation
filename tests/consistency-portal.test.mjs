import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, setupBusiness, invite } from './helpers.mjs';
import { id } from '../server/security.mjs';

const context = examId => ({ 'X-Exam-Id': examId });
async function redeem(client, link) {
  assert.equal((await client.call('/api/portal/redeem', 'POST', { token: link.token })).status, 200);
}
async function start(client, link) {
  return client.call('/api/portal/start', 'POST', { consent: true }, context(link.id));
}
async function manualStage(hr, candidateId, stage) {
  const candidate = (await hr.call('/api/candidates/' + candidateId)).body;
  const body = { name: candidate.name, email: candidate.email, phone: candidate.phone, stage, version: candidate.version };
  assert.equal((await hr.call('/api/candidates/' + candidateId, 'PUT', body)).status, 200);
  assert.equal((await hr.call('/api/candidates/' + candidateId, 'PUT', body)).status, 409);
}

test('同浏览器兑换 B 后，A 的全部会话操作被拒绝且不改变 B', async t => {
  const f = await fixture(); t.after(() => f.cleanup());
  const hr = f.client(), shared = f.client(); await hr.login();
  const a = await setupBusiness(hr), linkA = await invite(hr, a);
  const created = await hr.call('/api/candidates', 'POST', { jobId: a.jobId, name: '独立候选人 B', email: '', phone: '', resumeText: 'SQL', consent: true });
  const linkB = await invite(hr, { ...a, candidateId: created.body.id });
  await redeem(shared, linkA); assert.equal((await start(shared, linkA)).status, 200);
  await redeem(shared, linkB); assert.equal((await start(shared, linkB)).status, 200);
  const before = { ...f.db.prepare('SELECT * FROM exams WHERE id=?').get(linkB.id) };
  const payload = { revision: 0, answers: { [a.questionId]: 'A 的本地草稿，不能写入 B' }, usedAI: false };
  for (const [route, method, body] of [
    ['me', 'GET'], ['start', 'POST', { consent: true }], ['answers', 'PUT', payload],
    ['submit', 'POST', payload], ['events', 'POST', { eventId: id() }], ['logout', 'POST']
  ]) {
    const response = await shared.call('/api/portal/' + route, method, body, context(linkA.id));
    assert.equal(response.status, 409, route);
    assert.equal(response.body.code, 'PORTAL_CONTEXT_MISMATCH', route);
    assert.equal(response.body.id, undefined);
  }
  assert.deepEqual({ ...f.db.prepare('SELECT * FROM exams WHERE id=?').get(linkB.id) }, before);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM exam_events WHERE exam_id=?').get(linkB.id).n, 0);
  assert.equal((await shared.call('/api/portal/me', 'GET', undefined, context(linkB.id))).status, 200);
  assert.equal((await shared.call('/api/portal/me', 'GET', undefined, { 'X-Exam-Id': '' })).status, 400);
  assert.equal((await f.client().call('/api/portal/me', 'GET', undefined, context(linkB.id))).status, 401);
  assert.deepEqual(JSON.parse(f.db.prepare('SELECT answers FROM exams WHERE id=?').get(linkA.id).answers), {});
});

test('阶段自动迁移记录事件，撤销和过期恢复真实邀请前阶段，sweep 幂等', async t => {
  const f = await fixture(); t.after(() => f.cleanup()); const hr = f.client(), p = f.client(); await hr.login();
  const b = await setupBusiness(hr); let link = await invite(hr, b);
  await redeem(p, link); await start(p, link);
  assert.equal((await hr.call('/api/candidates/' + b.candidateId)).body.stage, '测评中');
  assert.equal((await hr.call('/api/exams/' + link.id + '/revoke', 'POST')).status, 200);
  assert.equal((await hr.call('/api/candidates/' + b.candidateId)).body.stage, '待筛选');
  link = await invite(hr, b);
  f.db.prepare('UPDATE exams SET expires_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z', link.id);
  f.sweep(); f.sweep();
  assert.equal((await hr.call('/api/candidates/' + b.candidateId)).body.stage, '待筛选');
  const expired = f.db.prepare("SELECT * FROM candidate_events WHERE candidate_id=? AND source='exam.expire'").all(b.candidateId);
  assert.equal(expired.length, 1); assert.equal(expired[0].from_stage, '待测评'); assert.equal(expired[0].to_stage, '待筛选');
  link = await invite(hr, b); await redeem(p, link); await start(p, link);
  const answers = { [b.questionId]: '截止前已保存' };
  await p.call('/api/portal/answers', 'PUT', { revision: 0, answers }, context(link.id));
  f.db.prepare('UPDATE exams SET deadline_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z', link.id);
  f.sweep(); f.sweep();
  assert.equal((await hr.call('/api/candidates/' + b.candidateId)).body.stage, '待复核');
  assert.deepEqual(JSON.parse(f.db.prepare('SELECT answers FROM exams WHERE id=?').get(link.id).answers), answers);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM candidate_events WHERE exam_id=? AND source='exam.timeout'").get(link.id).n, 1);
  for (const event of f.db.prepare('SELECT * FROM candidate_events WHERE candidate_id=?').all(b.candidateId)) {
    assert.ok(event.actor_id); assert.ok(event.created_at); assert.ok(event.reason); assert.ok(event.exam_id);
  }
});

test('人工推进后邀请、开始、提交、超时和撤销均保留人工阶段', async t => {
  const f = await fixture(); t.after(() => f.cleanup()); const hr = f.client(); await hr.login();
  for (const stage of ['面试中', '录用', '不合适']) {
    for (const trigger of ['invite', 'start', 'submit', 'timeout', 'revoke', 'expire']) {
      const b = await setupBusiness(hr), p = f.client();
      if (trigger === 'invite') await manualStage(hr, b.candidateId, stage);
      const link = await invite(hr, b); await redeem(p, link);
      if (['start', 'expire'].includes(trigger)) await manualStage(hr, b.candidateId, stage);
      if (trigger !== 'expire') assert.equal((await start(p, link)).status, 200);
      if (['submit', 'timeout', 'revoke'].includes(trigger)) await manualStage(hr, b.candidateId, stage);
      if (trigger === 'submit') assert.equal((await p.call('/api/portal/submit', 'POST', { revision: 0, answers: {}, usedAI: false }, context(link.id))).status, 200);
      if (trigger === 'revoke') assert.equal((await hr.call('/api/exams/' + link.id + '/revoke', 'POST')).status, 200);
      if (trigger === 'timeout' || trigger === 'expire') {
        f.db.prepare('UPDATE exams SET ' + (trigger === 'timeout' ? 'deadline_at' : 'expires_at') + '=? WHERE id=?').run('2020-01-01T00:00:00.000Z', link.id); f.sweep();
      }
      assert.equal((await hr.call('/api/candidates/' + b.candidateId)).body.stage, stage, stage + ' / ' + trigger);
    }
  }
});

test('人工返回测评阶段仍解除自动归属；旧库无归属不推测回退', async t => {
  const f = await fixture(); t.after(() => f.cleanup()); const hr = f.client(), p = f.client(); await hr.login();
  const b = await setupBusiness(hr), link = await invite(hr, b); await redeem(p, link); await start(p, link);
  await manualStage(hr, b.candidateId, '面试中'); await manualStage(hr, b.candidateId, '测评中');
  await p.call('/api/portal/submit', 'POST', { revision: 0, answers: {}, usedAI: false }, context(link.id));
  assert.equal((await hr.call('/api/candidates/' + b.candidateId)).body.stage, '测评中');
  const old = await setupBusiness(hr), oldLink = await invite(hr, old);
  f.db.prepare('UPDATE candidates SET stage_exam_id=NULL WHERE id=?').run(old.candidateId);
  f.db.prepare('UPDATE exams SET prior_stage=NULL WHERE id=?').run(oldLink.id);
  assert.equal((await hr.call('/api/exams/' + oldLink.id + '/revoke', 'POST')).status, 200);
  assert.equal((await hr.call('/api/candidates/' + old.candidateId)).body.stage, '待测评');
  assert.equal((await hr.call('/api/candidates/' + old.candidateId, 'DELETE')).status, 200);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM candidate_events WHERE candidate_id=?').get(old.candidateId).n, 0);
});
