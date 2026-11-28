import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { transaction } from '../server/db.mjs';
import { digest, id, now, token } from '../server/security.mjs';
import { fixture, setupBusiness } from '../tests/helpers.mjs';
import { createBackup, restoreBackup } from './backup.mjs';

const { values } = parseArgs({ options: { seconds: { type: 'string', default: '900' }, rounds: { type: 'string', default: '3' } } });
const seconds = Number(values.seconds), rounds = Number(values.rounds);
assert.ok(Number.isInteger(seconds) && seconds >= 5 && seconds <= 1800, '--seconds 需要 5–1800 的整数');
assert.ok(Number.isInteger(rounds) && rounds >= 1 && rounds <= 10, '--rounds 需要 1–10 的整数');
const resume = 'Synthetic resume with Node.js and SQL experience. '.repeat(85);
const resumeHash = digest(resume);
const stage = '待筛选';
const answerFor = revision => 'Synthetic answer version ' + revision + '. ' + 'A transaction preserves consistent order states. '.repeat(170);
const p95 = samples => {
  const ordered = [...samples].sort((a, b) => a - b);
  return +ordered[Math.ceil(ordered.length * .95) - 1].toFixed(2);
};

function seed(db, business, size, concurrency) {
  const time = now();
  const deadline = new Date(Date.now() + 14400000).toISOString();
  const expires = new Date(Date.now() + 86400000).toISOString();
  const exams = [];
  transaction(db, () => {
    const jobs = [business.jobId];
    const addJob = db.prepare(`
      INSERT INTO jobs(id,title,department,location,description,requirements,status,created_at,updated_at)
      VALUES(?,?,?,'Test','Synthetic position','["SQL"]','招聘中',?,?)
    `);
    for (let n = 1; n < 12; n++) {
      const jobId = id();
      jobs.push(jobId);
      addJob.run(jobId, 'Synthetic position ' + n, 'Department ' + n % 4, time, time);
    }
    const candidate = db.prepare(`
      INSERT INTO candidates(id,job_id,name,email,phone,stage,resume_text,skills,analysis,created_at,updated_at,consent_at)
      VALUES(?,?,?,'','',?,?,'["SQL"]',?,?,?,?)
    `);
    const addExam = db.prepare(`
      INSERT INTO exams(id,candidate_id,assessment_id,name,questions,duration,allow_ai,record_switch,token_hash,
        status,expires_at,started_at,deadline_at,submitted_at,answers,revision,created_at)
      VALUES(?,?,?,'Synthetic assessment',?,60,0,0,?,?,?,?,?,?,?,0,?)
    `);
    const addSession = db.prepare('INSERT INTO portal_sessions VALUES(?,?,?)');
    const questions = JSON.stringify([{ id: business.questionId, title: 'Synthetic question', rubric: 'Synthetic rubric', type:'简答题' }]);
    const history = JSON.stringify({ [business.questionId]: answerFor(0) });
    for (let n = 1; n < size; n++) {
      const inProgress = n <= concurrency;
      const jobId = inProgress ? business.jobId : jobs[n % jobs.length];
      const candidateId = id();
      const analysis = { method:'keyword', score:100, evidence:[{ requirement:'SQL', matched:true, quote:'SQL experience' }],
        source:{ jobId, jobVersion:1, resumeHash } };
      candidate.run(candidateId, jobId, 'Synthetic candidate ' + n, stage, resume, JSON.stringify(analysis), time, time, time);
      if (!inProgress && jobId !== business.jobId) continue;
      const examId = id();
      addExam.run(examId, candidateId, business.assessmentId, questions, digest(token()), inProgress ? 'in_progress' : 'submitted',
        expires, time, deadline, inProgress ? null : time, inProgress ? '{}' : history, time);
      if (!inProgress) continue;
      const session = token();
      addSession.run(digest(session), examId, expires);
      exams.push({ examId, session, revision: 0 });
    }
  });
  return exams;
}

async function exercise(f, staff, business, exams, outputDir) {
  const samples = { workspace: [], save: [], upload: [], backup: [] };
  const statuses = {};
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  let workspaceBytes = 0;
  let snapshot;
  let firstFailure;
  let failures = 0;
  async function measure(kind, run) {
    const started = performance.now();
    try { await run(); }
    catch (error) { failures++; firstFailure ??= error.message; }
    finally { samples[kind].push(performance.now() - started); }
  }
  function check(response, expected) {
    statuses[response.status] = (statuses[response.status] ?? 0) + 1;
    assert.equal(response.status, expected);
  }
  async function save(entry) {
    const answer = answerFor(entry.revision + 1);
    const response = await f.client().call('/api/portal/answers', 'PUT', {
      revision: entry.revision, answers: { [business.questionId]: answer }, usedAI:false
    }, { Cookie: 'td_portal=' + entry.session, 'X-Exam-Id': entry.examId });
    check(response, 200);
    assert.equal(response.body.revision, entry.revision + 1);
    assert.equal(response.body.answers[business.questionId], answer);
    entry.revision++;
  }

  const started = performance.now();
  eventLoop.enable();
  try {
    for (let cycle = 0; performance.now() - started < seconds * 1000; cycle++) {
      const tick = performance.now();
      const batch = exams.map(entry => measure('save', () => save(entry)));
      batch.push(measure('workspace', async () => {
        const response = await staff.call('/api/workspace?view=summary');
        check(response, 200);
        workspaceBytes = Buffer.byteLength(JSON.stringify(response.body));
      }));
      if (cycle % 4 === 1) batch.push(measure('upload', async () => {
        const form = new FormData();
        for (const [key, value] of Object.entries({ jobId: business.jobId, name:'Synthetic import', email:'', phone:'', consent:'true' })) {
          form.append(key, value);
        }
        form.append('resume', new Blob([resume]), 'synthetic.txt');
        check(await staff.call('/api/candidates/import', 'POST', form), 201);
      }));
      if (cycle === 0) batch.push(measure('backup', async () => { snapshot = await createBackup(f.dataDir, outputDir); }));
      await Promise.all(batch);
      await delay(Math.max(0, 1400 - (performance.now() - tick)));
    }
  } finally { eventLoop.disable(); }
  const elapsedSeconds = +((performance.now() - started) / 1000).toFixed(2);
  assert.equal(failures, 0, firstFailure);
  assert.ok(snapshot, '未生成在线快照');

  function reconcile(db, final) {
    const byId = db.prepare('SELECT revision, answers FROM exams WHERE id=?');
    for (const exam of exams) {
      const stored = byId.get(exam.examId);
      assert.ok(stored.revision <= exam.revision);
      if (final) assert.equal(stored.revision, exam.revision);
      const answer = stored.revision ? answerFor(stored.revision) : undefined;
      assert.equal(JSON.parse(stored.answers)[business.questionId], answer);
    }
  }
  reconcile(f.db, true);
  const restored = await restoreBackup(snapshot, path.join(outputDir, 'restored'));
  const checkDb = new DatabaseSync(path.join(restored, 'talent.sqlite'), { readOnly:true });
  try {
    reconcile(checkDb, false);
    assert.equal(checkDb.prepare('SELECT count(*) AS count FROM portal_sessions').get().count, 0);
  } finally { checkDb.close(); }
  return {
    elapsedSeconds, workspaceBytes, workspaceP95Ms: p95(samples.workspace), autosaveP95Ms: p95(samples.save),
    uploadP95Ms: samples.upload.length ? p95(samples.upload) : null, backupMs: +samples.backup[0].toFixed(2),
    eventLoopP95Ms: +(eventLoop.percentile(95) / 1e6).toFixed(2), statuses, restored: true
  };
}

for (const [size, concurrency] of [[1000,20], [10000,100]]) {
  for (let round = 1; round <= rounds; round++) {
    const f = await fixture({ aiKey:'', smtpUrl:'' });
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'talentdesk-pilot-capacity-'));
    try {
      const staff = f.client();
      assert.equal((await staff.login()).status, 200);
      const business = await setupBusiness(staff);
      const exams = seed(f.db, business, size, concurrency);
      const result = await exercise(f, staff, business, exams, outputDir);
      console.log(JSON.stringify({ size, concurrency, round, node:process.version, sqlite:process.versions.sqlite, ...result }));
      if (size === 1000) {
        assert.ok(result.workspaceP95Ms <= 800, '首档工作区 P95 超过 800 ms');
        assert.ok(result.autosaveP95Ms <= 1000, '首档保存 P95 超过 1 秒');
      }
    } finally {
      await f.cleanup();
      await rm(outputDir, { recursive:true, force:true });
    }
  }
}
