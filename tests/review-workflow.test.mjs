import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, invite, password, setupBusiness } from './helpers.mjs';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createBackup, restoreBackup } from '../scripts/backup.mjs';
import { digest, hashPassword, id, now } from '../server/security.mjs';

test('指定评审、独立草稿、改派、双评发布、撤回与历史记录', async t => {
  const f = await fixture();
  t.after(() => f.cleanup());
  const hr = f.client(), reviewer = f.client(), second = f.client(), replacement = f.client(), outsider = f.client(), candidate = f.client();
  const replacementId = id();
  f.db.prepare('INSERT INTO users(id,name,email,password_hash,role,department,must_change,created_at) VALUES(?,?,?,?,?,?,0,?)')
    .run(replacementId, '替补评审', 'replacement@example.test', await hashPassword(password), 'department', '技术部', now());
  assert.equal((await hr.login()).status, 200);
  assert.equal((await reviewer.login('department')).status, 200);
  assert.equal((await second.login('admin')).status, 200);
  assert.equal((await outsider.login('other')).status, 200);
  assert.equal((await replacement.call('/api/auth/login', 'POST', { email: 'replacement@example.test', password })).status, 200);

  const b = await setupBusiness(hr), invitation = await invite(hr, b);
  const route = '/api/exams/' + invitation.id;
  const details = async (client = hr) => {
    const result = await client.call(route);
    assert.equal(result.status, 200);
    return result.body;
  };
  const tasks = async client => (await client.call('/api/review-tasks')).body.tasks;
  const plan = {
    version: 0, ownerId: f.accounts.hr.id, reviewerIds: [f.accounts.department.id, f.accounts.admin.id],
    dueAt: new Date(Date.now() + 86400000).toISOString(), reason: '业务与部门双评'
  };
  assert.equal((await hr.call(route + '/review-plan', 'PUT', { ...plan, reviewerIds: [f.accounts.other.id] })).status, 400);
  assert.equal((await reviewer.call(route + '/review-plan', 'PUT', plan)).status, 403);
  assert.equal((await hr.call(route + '/review-plan', 'PUT', plan)).status, 200);
  assert.equal((await hr.call(route + '/review-plan', 'PUT', plan)).status, 409);
  assert.deepEqual(await tasks(reviewer), []);
  assert.equal((await replacement.call(route)).status, 404);
  assert.equal((await outsider.call(route)).status, 404);
  assert.deepEqual((await replacement.call('/api/workspace')).body.exams, []);
  assert.deepEqual(await tasks(replacement), []);
  assert.equal((await replacement.call('/api/export/candidates')).status, 403);

  assert.equal((await candidate.call('/api/portal/redeem', 'POST', { token: invitation.token })).status, 200);
  assert.equal((await candidate.call('/api/portal/start', 'POST', { consent: true })).status, 200);
  assert.equal((await candidate.call('/api/portal/submit', 'POST', {
    revision: 0, answers: { [b.questionId]: '使用事务和幂等键' }, usedAI: false
  })).status, 200);
  assert.deepEqual((await tasks(reviewer)).map(task => task.action), ['review']);
  assert.deepEqual((await tasks(hr)).map(task => task.action), ['follow-up']);
  assert.deepEqual(await tasks(outsider), []);

  const mine = (await details(reviewer)).workflow.mine;
  const rating = {
    taskId: mine.id, version: mine.version, ratings: { [b.questionId]: 4 },
    recommendation: '建议面试', note: '部门独立评分'
  };
  assert.equal((await reviewer.call(route + '/review', 'PUT', { ...rating, intent: 'draft' })).status, 200);
  assert.deepEqual((await details(second)).reviews, []);
  assert.deepEqual((await details()).reviews, []);
  assert.deepEqual((await details(reviewer)).workflow.mine.ratings, rating.ratings);
  assert.equal((await reviewer.call(route + '/review', 'PUT', rating)).status, 409);
  assert.equal((await reviewer.call(route + '/review', 'PUT', { ...rating, version: mine.version + 1 })).status, 200);
  assert.equal((await details(second)).workflow.submitted, 1);
  assert.deepEqual((await details(second)).reviews, []);
  assert.equal((await hr.call(route + '/feedback', 'POST', { message: '过早发布' })).status, 409);

  const oldSecond = (await details(second)).workflow.mine;
  const previous = (await details()).workflow;
  assert.equal((await hr.call(route + '/review-plan', 'PUT', {
    ...plan, version: previous.version, reviewerIds: [f.accounts.department.id, replacementId], reason: '替补接手'
  })).status, 200);
  assert.equal((await second.call(route + '/review', 'PUT', { ...rating, taskId: oldSecond.id, version: oldSecond.version })).status, 403);
  assert.equal((await details(replacement)).workflow.submitted, 1);
  assert.deepEqual((await details(replacement)).reviews, []);
  const replacementTask = (await details(replacement)).workflow.mine;
  assert.equal((await replacement.call(route + '/review', 'PUT', {
    ...rating, taskId: replacementTask.id, version: replacementTask.version, recommendation: '建议补充考察',
    ratings: { [b.questionId]: 2 }, note: '需要追问补偿逻辑'
  })).status, 200);
  const ready = await details();
  assert.equal(ready.workflow.canPublish, true);
  assert.equal(ready.reviews.length, 2);
  const decision = {
    version: ready.workflow.version, outcome: '补充考察', reason: '先核实失败补偿',
    evidence: [{ questionId: b.questionId, rationale: '答卷描述事务但缺少补偿步骤' }]
  };
  assert.equal((await hr.call(route + '/feedback', 'POST', { message: '感谢作答', decision })).status, 400);
  const complete = { message: '感谢作答', decision: { ...decision, disagreement: '以补充面试核实分歧' } };
  assert.equal((await hr.call(route + '/feedback', 'POST', complete)).status, 200);
  const view = (await candidate.call('/api/portal/me')).body;
  assert.equal(view.feedback.score, 60);
  assert.equal(view.workflow, undefined);
  assert.doesNotMatch(JSON.stringify(view), /补偿步骤|补充面试核实分歧|部门独立评分/);
  assert.deepEqual(await tasks(hr), []);

  const issue = async () => {
    const response = await hr.call(route + '/feedback-link', 'POST');
    assert.equal(response.status, 201);
    return response.body.url.split('/').at(-1);
  };
  const result = token => f.client().call('/api/portal/result', 'POST', { token });
  assert.equal((await reviewer.call(route + '/feedback-link', 'POST')).status, 403);
  const firstLink = await issue();
  const allowed = await result(firstLink);
  assert.equal(allowed.status, 200);
  assert.deepEqual(allowed.body, view.feedback);
  const secondLink = await issue();
  assert.equal((await result(firstLink)).status, 410);
  assert.equal((await result(secondLink)).status, 200);
  assert.ok((await details()).feedbackFirstAccessAt);
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM feedback_access_events WHERE exam_id=?').get(invitation.id).count, 1);

  const backupRoot = await mkdtemp(path.join(os.tmpdir(), 'talent-feedback-'));
  t.after(() => rm(backupRoot, { recursive: true, force: true }));
  const backup = await createBackup(f.dataDir, backupRoot);
  const restored = await restoreBackup(backup, path.join(backupRoot, 'restored'));
  const restoredDb = new DatabaseSync(path.join(restored, 'talent.sqlite'), { readOnly: true });
  try {
    assert.equal(restoredDb.prepare('SELECT count(*) AS count FROM feedback_links').get().count, 0);
    assert.ok(restoredDb.prepare('SELECT feedback FROM exams WHERE id=?').get(invitation.id).feedback);
    assert.equal(restoredDb.prepare('SELECT count(*) AS count FROM review_tasks WHERE exam_id=? AND active=1').get(invitation.id).count, 2);
  } finally { restoredDb.close(); }

  f.db.prepare('UPDATE feedback_links SET expires_at=? WHERE exam_id=?').run('2020-01-01T00:00:00.000Z', invitation.id);
  assert.equal((await result(secondLink)).status, 410);
  const finalLink = await issue();
  assert.equal((await result(finalLink)).status, 200);
  const published = await details();
  const assigned = published.workflow.assignments.find(task => task.userId === replacementId);
  assert.equal((await hr.call(route + '/review-reopen', 'POST', { taskId: assigned.id, version: assigned.version, reason: '补分' })).status, 409);
  assert.equal((await hr.call(route + '/feedback', 'DELETE')).status, 200);
  assert.equal((await candidate.call('/api/portal/me')).body.feedback, null);
  assert.equal((await result(finalLink)).status, 410);
  assert.equal((await hr.call(route + '/review-reopen', 'POST', { taskId: assigned.id, version: assigned.version, reason: '补分' })).status, 200);
  assert.deepEqual((await details(replacement)).reviews, []);
  assert.equal((await details()).workflow.lastPublication.decision.reason, decision.reason);

  const actions = f.db.prepare('SELECT action FROM review_workflow_events WHERE exam_id=? ORDER BY id').all(invitation.id).map(row => row.action);
  assert.deepEqual(actions, ['review.assign', 'review.draft', 'review.submit', 'review.reassign', 'review.submit', 'feedback.publish', 'feedback.retract', 'review.reopen']);
});

test('岗位默认安排仅影响新邀请，通知与时长调整在服务端校验并留痕', async t => {
  const f = await fixture();
  t.after(() => f.cleanup());
  const hr = f.client(), dept = f.client(), outsider = f.client(), candidate = f.client();
  await hr.login();
  await dept.login('department');
  await outsider.login('other');
  const b = await setupBusiness(hr);
  const legacy = await invite(hr, b);
  const policyPath = '/api/jobs/' + b.jobId + '/review-policy';
  const policy = {
    version: 0, enabled: true, ownerId: f.accounts.hr.id, reviewerIds: [f.accounts.department.id], dueHours: 48
  };
  assert.equal((await dept.call(policyPath)).status, 403);
  assert.equal((await dept.call(policyPath, 'PUT', policy)).status, 403);
  assert.equal((await hr.call(policyPath, 'PUT', { ...policy, reviewerIds: [f.accounts.other.id] })).status, 400);
  assert.equal((await hr.call(policyPath, 'PUT', policy)).status, 200);
  assert.equal((await hr.call(policyPath, 'PUT', policy)).status, 409);
  assert.equal((await dept.call('/api/exams/' + legacy.id)).body.workflow, null);
  const applicant = await hr.call('/api/candidates', 'POST', {
    jobId: b.jobId, name: '评审试点候选人', email: '', phone: '', resumeText: '体验 SQL 业务流程', consent: true
  });
  assert.equal(applicant.status, 201);
  const next = await invite(hr, { ...b, candidateId: applicant.body.id });
  const route = '/api/exams/' + next.id;
  assert.equal((await outsider.call(route)).status, 404);
  assert.equal((await hr.call(route)).body.workflow.dueHours, 48);
  assert.equal((await hr.call(policyPath, 'PUT', { version: 1, enabled: false })).status, 200);
  assert.equal((await dept.call(route)).body.workflow.required, 1);

  const adjust = { duration: 90, previous: 60, reason: '开考前确认计时安排' };
  assert.equal((await dept.call(route + '/duration', 'PUT', adjust)).status, 403);
  assert.equal((await hr.call(route + '/manual-notice', 'POST')).status, 200);
  assert.equal((await hr.call(route + '/manual-notice', 'POST')).status, 200);
  const redeem = await candidate.call('/api/portal/redeem', 'POST', { token: next.token });
  assert.equal(redeem.body.jobTitle, '后端工程师');
  assert.equal(redeem.body.duration, 60);
  assert.equal((await hr.call(route + '/duration', 'PUT', adjust)).status, 200);
  assert.equal((await hr.call(route + '/duration', 'PUT', adjust)).status, 409);
  const start = (duration) => candidate.call('/api/portal/start', 'POST', { consent: true, duration });
  assert.equal((await start(60)).status, 409);
  assert.equal((await start(90)).status, 200);
  assert.equal((await hr.call(route + '/duration', 'PUT', { ...adjust, previous: 90 })).status, 409);
  assert.equal((await candidate.call('/api/portal/submit', 'POST', { revision: 0, answers: {}, usedAI: false })).status, 200);
  const detail = (await dept.call(route)).body;
  assert.equal(detail.operationalEvents, undefined);
  const summary = (await dept.call('/api/workspace?view=summary')).body;
  const row = summary.candidates.find(person => person.id === applicant.body.id);
  assert.deepEqual(Object.keys(row.analysis).sort(), ['method', 'score', 'stale']);
  assert.equal(row.email, undefined);
  const outsideSummary = (await outsider.call('/api/workspace?view=summary')).body;
  assert.equal(outsideSummary.candidates.some(person => person.id === applicant.body.id), false);
  assert.equal(outsideSummary.exams.some(exam => exam.id === next.id), false);
  assert.equal(detail.workflow.dueHours, null);
  assert.equal(Date.parse(detail.workflow.dueAt) - Date.parse(detail.submittedAt), 48 * 3600000);
  const { operationalEvents } = (await hr.call(route)).body;
  assert.deepEqual(operationalEvents.map(event => event.action), ['exam.duration.adjust', 'exam.invite.opened', 'exam.invite.manual']);
  assert.equal(operationalEvents[0].details.reason, adjust.reason);

  const afterDisable = await invite(hr, { ...b, candidateId: applicant.body.id });
  assert.equal((await dept.call('/api/exams/' + afterDisable.id)).body.workflow, null);
});


test('待办分页以期限与测评编号稳定排序并保留角色过滤', async t => {
  const f = await fixture();
  t.after(() => f.cleanup());
  const hr = f.client(), reviewer = f.client(), outsider = f.client();
  await hr.login();
  await reviewer.login('department');
  await outsider.login('other');
  const b = await setupBusiness(hr);
  const dueAt = new Date(Date.now() + 86400000).toISOString();
  const time = now();
  const examIds = Array.from({ length: 101 }, () => id()).sort();
  const addExam = f.db.prepare(`
    INSERT INTO exams(id,candidate_id,assessment_id,name,questions,duration,allow_ai,record_switch,token_hash,status,expires_at,submitted_at,created_at)
    VALUES(?,?,?,'Synthetic review','[]',60,0,0,?,'submitted',?,?,?)
  `);
  const addPlan = f.db.prepare('INSERT INTO review_plans(exam_id,owner_id,due_at) VALUES(?,?,?)');
  const addTask = f.db.prepare('INSERT INTO review_tasks(id,exam_id,user_id,updated_at) VALUES(?,?,?,?)');
  for (const examId of examIds) {
    addExam.run(examId, b.candidateId, b.assessmentId, digest(examId), dueAt, time, time);
    addPlan.run(examId, f.accounts.hr.id, dueAt);
    addTask.run(id(), examId, f.accounts.department.id, time);
  }
  const route = '/api/review-tasks';
  const first = (await reviewer.call(route)).body;
  assert.deepEqual(first.tasks.map(task => task.examId), examIds.slice(0, 100));
  const nextRoute = route + '?' + new URLSearchParams(first.nextCursor);
  const next = (await reviewer.call(nextRoute)).body;
  assert.deepEqual(next.tasks.map(task => task.examId), examIds.slice(100));
  assert.equal(next.nextCursor, null);
  assert.deepEqual((await outsider.call(nextRoute)).body.tasks, []);
  assert.equal((await reviewer.call(route + '?dueAt=' + encodeURIComponent(dueAt))).status, 400);
});
