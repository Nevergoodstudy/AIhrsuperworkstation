import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

// Uses only disposable, uniquely named resources. Never reads .env or existing volumes.
const execute = promisify(execFile);
const image = process.argv[2] || 'talentdesk:ci';
const prefix = 'talentdesk-smoke-' + randomUUID().slice(0, 12);
const label = 'talentdesk.smoke=' + prefix;
const origin = 'https://smoke.example.test';
const password = 'Disposable-smoke-password-2026!';
const resume = 'Synthetic resume. I build Node.js services with SQL transactions.';
const containers = new Set(), volumes = new Set();
const started = Date.now();
const report = { image, startedAt: new Date().toISOString(), checks: [] };
async function docker(args, input) {
  if (input !== undefined) {
    return new Promise((resolve, reject) => {
      const child = execFile('docker', args, { timeout: 120000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve(stdout.trim()));
      child.stdin.end(input);
    });
  }
  return (await execute('docker', args, { timeout: 120000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
}
const sandbox = ['--read-only', '--tmpfs', '/tmp:size=64m,mode=1777', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true'];
async function volume(suffix) {
  const name = prefix + '-' + suffix;
  await docker(['volume', 'create', '--label', label, name]); volumes.add(name); return name;
}
async function moduleRun(suffix, mounts, source) {
  const name = prefix + '-' + suffix; containers.add(name);
  return docker(['run', '--rm', '-i', '--name', name, '--label', label, '--network', 'none', ...sandbox, ...mounts.flatMap(value => ['--mount', value]), '--entrypoint', 'node', image, '--input-type=module', '-'], source);
}
function client(base, initialCookies = {}) {
  const cookies = new Map(Object.entries(initialCookies));
  return {
    cookies,
    async call(route, method = 'GET', body, examId) {
      const response = await fetch(base + route, { method, signal: AbortSignal.timeout(15000), headers: {
        Origin: origin, 'X-Requested-With': 'TalentDesk', ...(examId ? { 'X-Exam-Id': examId } : {}),
        Cookie: [...cookies].map(([key, value]) => key + '=' + value).join('; '),
        ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {})
      }, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
      for (const value of response.headers.getSetCookie()) { const [name, ...parts] = value.split(';')[0].split('='); cookies.set(name, parts.join('=')); }
      const type = response.headers.get('content-type') || '';
      const result = type.includes('application/json') ? await response.json() : await response.text();
      return { status: response.status, body: result };
    }
  };
}
function expect(result, status) { assert.equal(result.status, status, JSON.stringify(result.body)); return result.body; }
async function ready(base) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try { const result = await fetch(base + '/api/ready', { signal: AbortSignal.timeout(2000) }); if (result.ok) return; } catch { /* startup or restart in progress */ }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('Container did not become ready within 45 seconds');
}
async function startApp(suffix, data, directory = '/app/data') {
  const name = prefix + '-' + suffix; containers.add(name);
  await docker(['run', '-d', '--name', name, '--label', label, '--init', ...sandbox,
    '--mount', `type=volume,source=${data},target=/app/data`, '-p', '127.0.0.1::3001',
    '-e', 'NODE_ENV=production', '-e', 'HOST=0.0.0.0', '-e', 'PORT=3001', '-e', 'DATA_DIR=' + directory,
    '-e', 'APP_URL=' + origin, '-e', 'AI_API_KEY=', '-e', 'SMTP_URL=', image]);
  const inspect = JSON.parse(await docker(['inspect', name]))[0];
  assert.ok(inspect.Config.User && !['0', 'root', '0:0'].includes(inspect.Config.User));
  assert.equal(inspect.HostConfig.ReadonlyRootfs, true);
  const port = inspect.NetworkSettings.Ports['3001/tcp'][0]; assert.equal(port.HostIp, '127.0.0.1');
  const base = 'http://127.0.0.1:' + port.HostPort; await ready(base);
  expect(await client(base).call('/api/health'), 200);
  const runtime = JSON.parse(await docker(['exec', name, 'node', '-e', `const fs=require('node:fs');console.log(JSON.stringify({uid:process.getuid(),mode:fs.statSync(process.env.DATA_DIR).mode&511,dbMode:fs.statSync(process.env.DATA_DIR+'/talent.sqlite').mode&511}))`]));
  assert.notEqual(runtime.uid, 0); assert.equal(runtime.mode, 0o700); assert.equal(runtime.dbMode, 0o600);
  return { name, base };
}
try {
  await docker(['info', '--format', '{{.ServerVersion}}']);
  report.imageId = JSON.parse(await docker(['image', 'inspect', image]))[0].Id;
  const data = await volume('data'), backups = await volume('backups'), restored = await volume('restored');
  await moduleRun('seed', [`type=volume,source=${data},target=/app/data`], `
    import {openDatabase} from './server/db.mjs';
    import {id,now,hashPassword} from './server/security.mjs';
    if(process.getuid()===0)throw new Error('Expected non-root image user');
    const db=openDatabase('/app/data');
    db.prepare('INSERT INTO users(id,name,email,password_hash,role,department,must_change,created_at) VALUES(?,?,?,?,?,?,0,?)').run(id(),'Smoke HR','smoke@example.test',await hashPassword(${JSON.stringify(password)}),'hr','',now());db.close();
  `);
  const app = await startApp('app', data), hr = client(app.base), portal = client(app.base);
  expect(await hr.call('/api/auth/login', 'POST', { email: 'smoke@example.test', password }), 200);
  const job = expect(await hr.call('/api/jobs', 'POST', { title: 'Synthetic engineer', department: 'Synthetic', location: 'Test', description: 'Synthetic isolation test', requirements: ['Node.js', 'SQL'], status: '招聘中' }), 201);
  const question = expect(await hr.call('/api/questions', 'POST', { title: 'Describe a transaction.', competency: 'SQL', type: '简答题', level: '基础', minutes: 5, rubric: 'Synthetic rubric', active: true }), 201);
  const assessment = expect(await hr.call('/api/assessments', 'POST', { jobId: job.id, name: 'Synthetic assessment', duration: 30, questionIds: [question.id], allowAI: false, randomize: false, recordSwitch: false }), 201);
  const form = new FormData();
  for (const [key, value] of Object.entries({ jobId: job.id, name: 'Synthetic candidate', email: 'candidate@example.test', phone: '', consent: 'true' })) form.append(key, value);
  form.append('resume', new Blob([resume]), 'synthetic-resume.txt');
  const candidate = expect(await hr.call('/api/candidates/import', 'POST', form), 201);
  const invitation = expect(await hr.call('/api/exams', 'POST', { candidateId: candidate.id, assessmentId: assessment.id, sendEmail: false }), 201);
  const inviteToken = invitation.inviteUrl.split('/').pop();
  expect(await portal.call('/api/portal/redeem', 'POST', { token: inviteToken }), 200);
  expect(await portal.call('/api/portal/start', 'POST', { consent: true }, invitation.id), 200);
  const answers = { [question.id]: 'Synthetic answer: use a database transaction.' };
  expect(await portal.call('/api/portal/answers', 'PUT', { revision: 0, answers, usedAI: false }, invitation.id), 200);
  assert.equal(expect(await hr.call('/api/candidates/' + candidate.id + '/resume'), 200), resume);
  report.checks.push('non-root/read-only container, health/ready, private disk permissions, synthetic HTTP workflow');
  await docker(['restart', app.name]); await ready(app.base);
  assert.deepEqual(expect(await portal.call('/api/portal/me', 'GET', undefined, invitation.id), 200).answers, answers);
  assert.equal(expect(await hr.call('/api/candidates/' + candidate.id + '/resume'), 200), resume);
  report.checks.push('restart preserved answers, staff/portal sessions and original resume');
  const snapshot = JSON.parse(await moduleRun('backup', [`type=volume,source=${data},target=/app/data,readonly`, `type=volume,source=${backups},target=/backups`], `
    import {createBackup,verifyBackup} from './scripts/backup.mjs';
    const path=await createBackup('/app/data','/backups');await verifyBackup(path);console.log(JSON.stringify({path}));
  `)).path;
  assert.match(snapshot, /^\/backups\/[^/]+$/);
  const detail = expect(await hr.call('/api/candidates/' + candidate.id), 200);
  expect(await hr.call('/api/candidates/' + candidate.id, 'PUT', { name: 'Changed after backup', email: detail.email, phone: detail.phone, stage: detail.stage, version: detail.version }), 200);
  await moduleRun('restore', [`type=volume,source=${backups},target=/backups,readonly`, `type=volume,source=${restored},target=/app/data`], `
    import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFile} from 'node:fs/promises';
    import {restoreBackup} from './scripts/backup.mjs';
    const target=await restoreBackup(${JSON.stringify(snapshot)},'/app/data/recovered');
    await assert.rejects(restoreBackup(${JSON.stringify(snapshot)},target));
    const db=new DatabaseSync(target+'/talent.sqlite');
    for(const table of ['sessions','portal_sessions'])assert.equal(db.prepare('SELECT count(*) AS n FROM '+table).get().n,0);
    const c=db.prepare('SELECT * FROM candidates WHERE id=?').get(${JSON.stringify(candidate.id)});assert.equal(c.name,'Synthetic candidate');
    assert.equal(await readFile(target+'/resumes/'+c.file_key,'utf8'),${JSON.stringify(resume)});db.close();
  `);
  const recovery = await startApp('recovered', restored, '/app/data/recovered');
  const staleHr = client(recovery.base, Object.fromEntries(hr.cookies)), stalePortal = client(recovery.base, Object.fromEntries(portal.cookies));
  expect(await staleHr.call('/api/auth/me'), 401);
  expect(await stalePortal.call('/api/portal/me', 'GET', undefined, invitation.id), 401);
  expect(await staleHr.call('/api/auth/login', 'POST', { email: 'smoke@example.test', password }), 200);
  assert.equal(expect(await staleHr.call('/api/candidates/' + candidate.id), 200).name, 'Synthetic candidate');
  assert.equal(expect(await staleHr.call('/api/candidates/' + candidate.id + '/resume'), 200), resume);
  expect(await stalePortal.call('/api/portal/redeem', 'POST', { token: inviteToken }), 200);
  assert.deepEqual(expect(await stalePortal.call('/api/portal/me', 'GET', undefined, invitation.id), 200).answers, answers);
  report.checks.push('online snapshot verified; new volume restored; original bytes and snapshot state verified; old sessions rejected; fresh login/redeem worked; existing restore target rejected');
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.code === 'ENOENT' ? 'Docker CLI is unavailable; container acceptance did not run.' : error.message;
  process.exitCode = 1;
} finally {
  const cleanupErrors = [];
  for (const name of containers) {
    try { const current = JSON.parse(await docker(['inspect', name]))[0]; if (current.Config.Labels?.['talentdesk.smoke'] === prefix) await docker(['rm', '-f', name]); }
    catch (error) { if (!String(error.stderr).includes('No such')) cleanupErrors.push('container: ' + name); }
  }
  for (const name of volumes) {
    try { const current = JSON.parse(await docker(['volume', 'inspect', name]))[0]; assert.equal(current.Labels?.['talentdesk.smoke'], prefix); await docker(['volume', 'rm', name]); }
    catch { cleanupErrors.push('volume: ' + name); }
  }
  if (cleanupErrors.length) { report.status = 'failed'; report.cleanupErrors = cleanupErrors; process.exitCode = 1; }
  report.elapsedSeconds = Math.round((Date.now() - started) / 100) / 10;
  console.log(JSON.stringify(report, null, 2));
}
