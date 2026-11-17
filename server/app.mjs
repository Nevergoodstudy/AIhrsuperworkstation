import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import path from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { writeFile, unlink } from 'node:fs/promises';
import { randomInt } from 'node:crypto';
import { z, ZodError } from 'zod';
import { openDatabase, transaction, json } from './db.mjs';
import { getConfig } from './config.mjs';
import { id, now, token, digest, hashPassword, verifyPassword, cookieValue, setCookie, publicUser, audit, fail, limit, redact } from './security.mjs';
import { extractResume, ruleAnalysis, contactHints } from './resumes.mjs';
import { analyzeWithAI, AI_PROMPT_VERSION } from './ai.mjs';
import { createMailTransport } from './mail.mjs';
import { applyExamStage, recordStageEvent } from './candidate-stages.mjs';
const text = (max = 300) => z.string().trim().max(max);
const required = (max = 300) => text(max).min(1);
const email = z.string().trim().email().max(254).transform(value => value.toLowerCase());
const password = z.string().min(12).max(128);
const stages = ['待筛选', '待测评', '测评中', '待复核', '面试中', '录用', '不合适'];
const jobSchema = z.object({ title: required(100), department: required(100), location: required(100), description: required(10000), requirements: z.array(required(300)).max(50), status: z.enum(['招聘中', '暂停', '已关闭']) });
const questionSchema = z.object({ title: required(10000), competency: required(100), type: z.enum(['情景题', '实操题', '简答题']), level: z.enum(['基础', '进阶', '专家']), minutes: z.number().int().min(1).max(180), rubric: required(5000), active: z.boolean().default(true) });
const assessmentSchema = z.object({ jobId: z.string().uuid(), name: required(100), duration: z.number().int().min(1).max(240), questionIds: z.array(z.string().uuid()).min(1).max(50), allowAI: z.boolean(), randomize: z.boolean(), recordSwitch: z.boolean() });
const answerSchema = z.object({ revision: z.number().int().min(0), answers: z.record(z.string().uuid(), z.string().max(20000)), usedAI: z.boolean().optional() });
const candidateSchema = z.object({ jobId: z.string().uuid(), name: required(100), email: email.or(z.literal('')), phone: text(50), resumeText: required(500000), consent: z.literal(true) });
function shuffle(array) { for (let i = array.length - 1; i > 0; i--) { const j = randomInt(i + 1); [array[i], array[j]] = [array[j], array[i]]; } return array; }
export function createApp(overrides = {}) {
  const config = getConfig(overrides), db = openDatabase(config.dataDir), app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: [`'self'`], scriptSrc: [`'self'`], styleSrc: [`'self'`, `'unsafe-inline'`], imgSrc: [`'self'`, 'data:'], fontSrc: [`'self'`], connectSrc: [`'self'`], objectSrc: [`'none'`], frameAncestors: [`'none'`], upgradeInsecureRequests: config.secureCookies ? [] : null } }, referrerPolicy: { policy: 'no-referrer' } }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (req.headers.origin !== config.appUrl || req.headers['x-requested-with'] !== 'TalentDesk')) return next(fail(403, '请求来源校验失败，请从工作区页面操作'));
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 8, fieldSize: 1024 * 1024 } });
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  function sweep() {
    const time = now();
    transaction(db, () => {
      for (const exam of all(`SELECT * FROM exams WHERE status='invited' AND expires_at <= ?`, time)) {
        run(`UPDATE exams SET status='expired',revision=revision+1 WHERE id=?`, exam.id);
        applyExamStage(db, exam, 'exam.expire', 'system');
      }
      for (const exam of all(`SELECT * FROM exams WHERE status='in_progress' AND deadline_at <= ?`, time)) {
        run(`UPDATE exams SET status='submitted', submitted_at=?, revision=revision+1 WHERE id=?`, time, exam.id);
        applyExamStage(db, exam, 'exam.timeout', 'system');
      }
      run('DELETE FROM sessions WHERE expires_at <= ?', time); run('DELETE FROM portal_sessions WHERE expires_at <= ?', time);
    });
    for (const row of all('SELECT file_key FROM file_cleanup LIMIT 20')) {
      try { unlinkSync(path.join(config.dataDir, 'resumes', row.file_key)); run('DELETE FROM file_cleanup WHERE file_key=?', row.file_key); }
      catch (error) { if (error.code === 'ENOENT') run('DELETE FROM file_cleanup WHERE file_key=?', row.file_key); }
    }
  }
  const currentStaff = req => {
    const raw = cookieValue(req, 'td_session');
    return raw ? one('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires_at>? AND u.active=1', digest(raw), now()) : null;
  };
  const staff = (req, res, next) => {
    req.user = currentStaff(req);
    if (!req.user) return next(fail(401, '请先登录'));
    if (req.user.must_change && !['/api/auth/me', '/api/auth/password', '/api/auth/logout'].includes(req.path)) return next(fail(403, '首次登录或密码重置后必须先修改密码'));
    next();
  };
  const hr = (req, res, next) => ['admin', 'hr'].includes(req.user.role) ? next() : next(fail(403, '此操作仅限 HR 或管理员'));
  const admin = (req, res, next) => req.user.role === 'admin' ? next() : next(fail(403, '此操作仅限管理员'));
  function jobFor(user, jobId) {
    const job = one('SELECT * FROM jobs WHERE id=?', jobId);
    if (!job || (user.role === 'department' && job.department !== user.department)) throw fail(404, '岗位不存在或无访问权限');
    return { ...job, requirements: json(job.requirements, []) };
  }
  function candidateFor(user, candidateId) {
    const candidate = one('SELECT * FROM candidates WHERE id=?', candidateId);
    if (!candidate) throw fail(404, '候选人不存在或无访问权限');
    jobFor(user, candidate.job_id); return candidate;
  }
  function examFor(user, examId) {
    sweep(); const exam = one('SELECT * FROM exams WHERE id=?', examId);
    if (!exam) throw fail(404, '测评不存在或无访问权限');
    candidateFor(user, exam.candidate_id); return exam;
  }
  function cleanCandidate(candidate, user, detailed = false) {
    const analysis = analysisView(candidate);
    const result = { id: candidate.id, jobId: candidate.job_id, name: candidate.name, stage: candidate.stage, skills: analysis.stale ? [] : json(candidate.skills, []), analysis, version: candidate.version, createdAt: candidate.created_at, updatedAt: candidate.updated_at, consentAt: candidate.consent_at };
    if (user.role === 'department') { result.skills = result.skills.map(redact); result.analysis = { ...result.analysis, summary: redact(result.analysis.summary ?? ''), evidence: (result.analysis.evidence ?? []).map(e => ({ ...e, requirement: redact(e.requirement), quote: redact(e.quote) })) }; }
    else Object.assign(result, { email: candidate.email, phone: candidate.phone, fileName: candidate.file_name, hasFile: Boolean(candidate.file_key), ...(detailed ? { resumeText: candidate.resume_text } : {}) });
    return result;
  }
  function analysisSource(candidate, job, method, userId) {
    return { jobId: job.id, jobVersion: job.version, resumeHash: digest(candidate.resume_text), candidateVersion: candidate.version, model: method === 'ai' ? config.aiModel : 'keyword-v1', promptVersion: method === 'ai' ? AI_PROMPT_VERSION : 'keyword-v1', requestedBy: userId };
  }
  function analysisView(candidate) {
    const analysis = json(candidate.analysis, {}), source = analysis.source, job = one('SELECT version FROM jobs WHERE id=?', candidate.job_id);
    const staleReason = !source ? '历史分析未记录输入版本，请重新分析' : source.jobId !== candidate.job_id || source.jobVersion !== job?.version ? '岗位已更新，请重新分析' : source.resumeHash !== digest(candidate.resume_text) ? '简历已更新，请重新分析' : '';
    return { ...analysis, stale: Boolean(staleReason), staleReason, ...(analysis.method === 'ai' ? { summaryNeedsReview: true } : {}) };
  }
  function cleanExam(exam) { return { id: exam.id, candidateId: exam.candidate_id, assessmentId: exam.assessment_id, name: exam.name, duration: exam.duration, status: exam.status, expiresAt: exam.expires_at, startedAt: exam.started_at, deadlineAt: exam.deadline_at, submittedAt: exam.submitted_at, feedback: json(exam.feedback), mailStatus: exam.mail_status, createdAt: exam.created_at }; }
  const cleanAssessment = a => ({ id: a.id, jobId: a.job_id, name: a.name, duration: a.duration, questionIds: json(a.question_ids, []), allowAI: Boolean(a.allow_ai), randomize: Boolean(a.randomize), recordSwitch: Boolean(a.record_switch), version: a.version });
  function reviewRows(examId) { return all('SELECT r.*,u.name AS reviewer FROM reviews r JOIN users u ON u.id=r.user_id WHERE exam_id=? ORDER BY r.updated_at DESC', examId).map(r => ({ id: r.id, userId: r.user_id, reviewer: r.reviewer, ratings: json(r.ratings, {}), recommendation: r.recommendation, note: r.note, updatedAt: r.updated_at, version: r.version })); }
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/ready', (req, res) => { one('SELECT 1'); res.json({ status: 'ready' }); });
  app.post('/api/auth/login', async (req, res) => {
    const body = z.object({ email, password: z.string().min(1).max(128) }).parse(req.body);
    limit(db, 'login-ip:' + req.ip, 40, 15 * 60000); limit(db, 'login-account:' + digest(body.email), 12, 15 * 60000);
    const user = one('SELECT * FROM users WHERE email=?', body.email);
    const valid = await verifyPassword(body.password, user?.password_hash ?? ('0'.repeat(32) + ':' + '0'.repeat(128)));
    const latest = user && one('SELECT * FROM users WHERE id=?', user.id);
    if (!valid || !latest?.active || latest.password_hash !== user.password_hash) throw fail(401, '邮箱或密码不正确');
    const raw = token(); run('INSERT INTO sessions VALUES(?,?,?)', digest(raw), user.id, new Date(Date.now() + 8 * 3600000).toISOString());
    setCookie(res, config, 'td_session', raw, 8 * 3600000); audit(db, user.id, 'auth.login', user.id);
    res.json({ user: publicUser(latest), company: config.company });
  });
  app.get('/api/auth/me', staff, (req, res) => res.json({ user: publicUser(req.user), company: config.company }));
  app.post('/api/auth/logout', (req, res) => { run('DELETE FROM sessions WHERE hash=?', digest(cookieValue(req, 'td_session'))); setCookie(res, config, 'td_session', '', 0); res.json({ ok: true }); });
  app.post('/api/auth/password', staff, async (req, res) => {
    const body = z.object({ current: z.string().max(128), password }).parse(req.body);
    limit(db, 'password:' + req.user.id, 10, 15 * 60000);
    if (!await verifyPassword(body.current, req.user.password_hash)) throw fail(400, '当前密码不正确');
    if (body.current === body.password) throw fail(400, '新密码不能与原密码相同');
    const hash = await hashPassword(body.password);
    transaction(db, () => { const latest = currentStaff(req); if (!latest || latest.password_hash !== req.user.password_hash) throw fail(409, '账号状态已更新，请重新登录'); run('UPDATE users SET password_hash=?,must_change=0 WHERE id=?', hash, req.user.id); run('DELETE FROM sessions WHERE user_id=?', req.user.id); audit(db, req.user.id, 'auth.password', req.user.id); });
    setCookie(res, config, 'td_session', '', 0); res.json({ ok: true });
  });
  app.get('/api/workspace', staff, (req, res) => {
    sweep(); const scoped = req.user.role === 'department';
    const jobs = all('SELECT * FROM jobs' + (scoped ? ' WHERE department=?' : '') + ' ORDER BY created_at DESC', ...(scoped ? [req.user.department] : [])).map(j => ({ ...j, requirements: json(j.requirements, []) }));
    const visible = new Set(jobs.map(j => j.id));
    const candidates = all('SELECT * FROM candidates ORDER BY created_at DESC').filter(c => visible.has(c.job_id));
    const candidateIds = new Set(candidates.map(c => c.id));
    res.json({ company: config.company, user: publicUser(req.user), jobs, candidates: candidates.map(c => cleanCandidate(c, req.user)), questions: all('SELECT * FROM questions ORDER BY created_at DESC').map(q => ({ ...q, active: Boolean(q.active) })), assessments: all('SELECT * FROM assessments ORDER BY created_at DESC').filter(a => visible.has(a.job_id)).map(cleanAssessment), exams: all('SELECT * FROM exams ORDER BY created_at DESC').filter(e => candidateIds.has(e.candidate_id)).map(cleanExam), readiness: { ai: Boolean(config.aiKey && config.aiModel), email: Boolean(config.smtpUrl && config.mailFrom), secure: config.secureCookies } });
  });
  app.post('/api/jobs', staff, hr, (req, res) => {
    const b = jobSchema.parse(req.body), key = id(), time = now();
    run('INSERT INTO jobs(id,title,department,location,description,requirements,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', key, b.title, b.department, b.location, b.description, JSON.stringify([...new Set(b.requirements)]), b.status, time, time);
    audit(db, req.user.id, 'job.create', key); res.status(201).json({ id: key });
  });
  app.put('/api/jobs/:id', staff, hr, (req, res) => {
    const b = jobSchema.extend({ version: z.number().int() }).parse(req.body); jobFor(req.user, req.params.id);
    const result = run('UPDATE jobs SET title=?,department=?,location=?,description=?,requirements=?,status=?,version=version+1,updated_at=? WHERE id=? AND version=?', b.title, b.department, b.location, b.description, JSON.stringify([...new Set(b.requirements)]), b.status, now(), req.params.id, b.version);
    if (!result.changes) throw fail(409, '岗位已被其他人修改，请刷新后重试');
    audit(db, req.user.id, 'job.update', req.params.id); res.json({ ok: true });
  });
  async function addCandidate(req, res, buffer, filename) {
    const b = candidateSchema.parse(req.body), job = jobFor(req.user, b.jobId);
    if (job.status !== '招聘中') throw fail(409, '该岗位当前不接受新增候选人');
    const key = id(), fileKey = buffer ? id() : null, time = now(), analysis = { ...ruleAnalysis(b.resumeText, job.requirements), source: analysisSource({ resume_text: b.resumeText, version: 1 }, job, 'keyword', req.user.id) };
    if (fileKey) await writeFile(path.join(config.dataDir, 'resumes', fileKey), buffer, { mode: 0o600, flag: 'wx' });
    try { run('INSERT INTO candidates(id,job_id,name,email,phone,stage,resume_text,file_key,file_name,skills,analysis,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', key, b.jobId, b.name, b.email, b.phone, '待筛选', b.resumeText, fileKey, filename ?? null, JSON.stringify(analysis.evidence.filter(e => e.matched).map(e => e.requirement)), JSON.stringify(analysis), time, time); }
    catch (error) { if (fileKey) await unlink(path.join(config.dataDir, 'resumes', fileKey)).catch(() => {}); throw error; }
    run('UPDATE candidates SET consent_at=? WHERE id=?', time, key); audit(db, req.user.id, 'candidate.create', key); res.status(201).json({ id: key });
  }
  app.post('/api/candidates', staff, hr, (req, res) => addCandidate(req, res));
  app.post('/api/candidates/import', staff, hr, upload.single('resume'), async (req, res) => {
    if (!req.file) throw fail(400, '请选择简历文件');
    const resumeText = await extractResume(req.file.buffer, req.file.originalname);
    const hints = contactHints(resumeText);
    req.body = { ...hints, ...req.body, consent: req.body.consent === 'true', resumeText };
    await addCandidate(req, res, req.file.buffer, path.basename(req.file.originalname).slice(0, 200));
  });
  app.get('/api/candidates/:id', staff, (req, res) => res.json(cleanCandidate(candidateFor(req.user, req.params.id), req.user, true)));
  app.put('/api/candidates/:id', staff, hr, (req, res) => {
    const b = z.object({ name: required(100), email: email.or(z.literal('')), phone: text(50), stage: z.enum(stages), version: z.number().int() }).parse(req.body);
    transaction(db, () => {
      const c = candidateFor(req.user, req.params.id);
      if (!run('UPDATE candidates SET name=?,email=?,phone=?,stage=?,stage_exam_id=?,version=version+1,updated_at=? WHERE id=? AND version=?', b.name, b.email, b.phone, b.stage, b.stage === c.stage ? c.stage_exam_id : null, now(), c.id, b.version).changes) throw fail(409, '候选人已被其他人修改，请刷新后重试');
      if (b.stage !== c.stage) recordStageEvent(db, c, b.stage, 'staff.stage', req.user.id, 'HR 在候选人资料中手动调整招聘阶段', c.stage_exam_id);
      audit(db, req.user.id, 'candidate.update', req.params.id);
    }); res.json({ ok: true });
  });
  app.get('/api/candidates/:id/resume', staff, hr, (req, res) => {
    const c = candidateFor(req.user, req.params.id);
    if (!c.file_key) throw fail(404, '此候选人没有上传简历原件');
    audit(db, req.user.id, 'resume.download', c.id);
    res.set('Content-Type', 'application/octet-stream'); res.download(path.join(config.dataDir, 'resumes', c.file_key), c.file_name);
  });
  app.delete('/api/candidates/:id', staff, hr, async (req, res) => {
    const c = candidateFor(req.user, req.params.id);
    transaction(db, () => { if (c.file_key) run('INSERT OR IGNORE INTO file_cleanup VALUES(?)', c.file_key); run('DELETE FROM candidates WHERE id=?', c.id); audit(db, req.user.id, 'candidate.delete', c.id); });
    sweep();
    res.json({ ok: true });
  });
  app.post('/api/candidates/:id/analyze', staff, hr, async (req, res) => {
    const b = z.object({ method: z.enum(['keyword', 'ai']), consent: z.boolean().default(false) }).parse(req.body), c = candidateFor(req.user, req.params.id), job = jobFor(req.user, c.job_id);
    if (b.method === 'ai') {
      if (!b.consent) throw fail(400, '请先确认已获得向 AI 服务发送简历的授权');
      limit(db, 'ai:' + req.user.id, 20, 3600000);
    }
    const runId = id(), source = { ...analysisSource(c, job, b.method, req.user.id), runId };
    run(`INSERT INTO analysis_runs(id,candidate_id,job_id,candidate_version,job_version,resume_hash,model,prompt_version,requested_by,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'running',?)`, runId, c.id, job.id, c.version, job.version, source.resumeHash, source.model, source.promptVersion, req.user.id, now());
    let analysis;
    try { analysis = { ...(b.method === 'ai' ? await analyzeWithAI(config, c.resume_text, job) : ruleAnalysis(c.resume_text, job.requirements)), source }; }
    catch (error) { run("UPDATE analysis_runs SET status='failed',reason=?,completed_at=? WHERE id=?", '分析服务或返回证据校验失败', now(), runId); throw error; }
    const rejection = transaction(db, () => {
      const actor = currentStaff(req), latest = one('SELECT * FROM candidates WHERE id=?', c.id), latestJob = one('SELECT * FROM jobs WHERE id=?', job.id);
      let error;
      if (!actor || actor.id !== req.user.id || !['admin', 'hr'].includes(actor.role) || actor.must_change) error = fail(403, '账号或会话已失效，分析结果未保存，请重新登录');
      else if (!latest) error = fail(404, '候选人已删除，分析结果未保存');
      else if (latest.version !== c.version || latest.job_id !== job.id || digest(latest.resume_text) !== source.resumeHash || latestJob?.version !== job.version) error = fail(409, '候选人或岗位已变更，旧分析已作废，请刷新后重试');
      if (error) {
        run('UPDATE analysis_runs SET status=?,reason=?,completed_at=? WHERE id=?', error.status === 403 ? 'rejected' : 'superseded', error.message, now(), runId);
        return error;
      }
      run('UPDATE candidates SET analysis=?,skills=?,version=version+1,updated_at=? WHERE id=? AND version=?', JSON.stringify(analysis), JSON.stringify(analysis.evidence.filter(e => e.matched).map(e => e.requirement)), now(), c.id, c.version);
      run("UPDATE analysis_runs SET status='completed',completed_at=? WHERE id=?", now(), runId);
      audit(db, actor.id, 'candidate.analyze.' + b.method, c.id);
      return null;
    });
    if (rejection) throw rejection;
    res.json({ analysis: analysisView(one('SELECT * FROM candidates WHERE id=?', c.id)) });
  });
  app.get('/api/export/candidates', staff, hr, (req, res) => {
    const cells = value => { let v = String(value ?? '').replace(/[\r\n]/g, ' '); if (/^[=+@\-\t]/.test(v.trimStart())) v = String.fromCharCode(39) + v; return String.fromCharCode(34) + v.replaceAll(String.fromCharCode(34), String.fromCharCode(34).repeat(2)) + String.fromCharCode(34); };
    const rows = [['姓名', '邮箱', '电话', '岗位', '阶段', '关键词或证据覆盖率', '分析方式', '分析状态', '创建时间'], ...all('SELECT c.*,j.title FROM candidates c JOIN jobs j ON j.id=c.job_id ORDER BY c.created_at DESC').map(c => { const a = analysisView(c); return [c.name, c.email, c.phone, c.title, c.stage, a.stale ? '' : a.score ?? '', a.method, a.stale ? a.staleReason : '当前版本', c.created_at]; })];
    audit(db, req.user.id, 'candidate.export', 'workspace'); res.attachment('candidates.csv').type('text/csv; charset=utf-8').send('\uFEFF' + rows.map(row => row.map(cells).join(',')).join('\r\n'));
  });
  app.post('/api/questions', staff, hr, (req, res) => {
    const b = questionSchema.parse(req.body), key = id(), time = now();
    run('INSERT INTO questions(id,title,competency,type,level,minutes,rubric,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', key, b.title, b.competency, b.type, b.level, b.minutes, b.rubric, +b.active, time, time);
    audit(db, req.user.id, 'question.create', key); res.status(201).json({ id: key });
  });
  app.put('/api/questions/:id', staff, hr, (req, res) => {
    const b = questionSchema.extend({ version: z.number().int().positive() }).parse(req.body);
    if (!run('UPDATE questions SET title=?,competency=?,type=?,level=?,minutes=?,rubric=?,active=?,updated_at=?,version=version+1 WHERE id=? AND version=?', b.title, b.competency, b.type, b.level, b.minutes, b.rubric, +b.active, now(), req.params.id, b.version).changes) throw fail(409, '题目已被修改或不存在，请刷新后重试');
    audit(db, req.user.id, 'question.update', req.params.id); res.json({ ok: true });
  });
  function validateAssessment(user, b) {
    jobFor(user, b.jobId);
    if (new Set(b.questionIds).size !== b.questionIds.length) throw fail(400, '题目不能重复选择');
    for (const key of b.questionIds) if (!one('SELECT id FROM questions WHERE id=? AND active=1', key)) throw fail(400, '选中的题目不存在或已停用');
  }
  app.post('/api/assessments', staff, hr, (req, res) => {
    const b = assessmentSchema.parse(req.body); validateAssessment(req.user, b); const key = id(), time = now();
    run('INSERT INTO assessments(id,job_id,name,duration,question_ids,allow_ai,randomize,record_switch,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', key, b.jobId, b.name, b.duration, JSON.stringify(b.questionIds), +b.allowAI, +b.randomize, +b.recordSwitch, time, time);
    audit(db, req.user.id, 'assessment.create', key); res.status(201).json({ id: key });
  });
  app.put('/api/assessments/:id', staff, hr, (req, res) => {
    const b = assessmentSchema.extend({ version: z.number().int().positive() }).parse(req.body); validateAssessment(req.user, b);
    if (!run('UPDATE assessments SET job_id=?,name=?,duration=?,question_ids=?,allow_ai=?,randomize=?,record_switch=?,updated_at=?,version=version+1 WHERE id=? AND version=?', b.jobId, b.name, b.duration, JSON.stringify(b.questionIds), +b.allowAI, +b.randomize, +b.recordSwitch, now(), req.params.id, b.version).changes) throw fail(409, '方案已被修改或不存在，请刷新后重试');
    audit(db, req.user.id, 'assessment.update', req.params.id); res.json({ ok: true });
  });
  async function deliverInvitation(exam, candidate, raw) {
    if (!config.smtpUrl || !config.mailFrom) throw fail(503, '邮件服务尚未配置，请复制邀请链接发送');
    if (!candidate.email) throw fail(400, '候选人尚未填写邮箱');
    try {
      const transport = config.mailer ?? createMailTransport(config);
      const info = await transport.sendMail({ from: config.mailFrom, to: candidate.email, subject: config.company + ' · 测评邀请', text: candidate.name + '，您好：\n请通过以下个人链接完成 ' + exam.name + '。请勿转发此链接。\n' + config.appUrl + '/#/invite/' + raw + '\n邀请有效期至：' + exam.expires_at + '。开始后限时 ' + exam.duration + ' 分钟。' });
      if (info.rejected?.length) throw new Error('rejected');
      run(`UPDATE exams SET mail_status='accepted' WHERE id=?`, exam.id); return 'accepted';
    } catch { run(`UPDATE exams SET mail_status='failed' WHERE id=?`, exam.id); throw fail(502, '邮件未被发送服务接受；可复制链接发送，或检查 SMTP 后重试'); }
  }
  app.post('/api/exams', staff, hr, async (req, res) => {
    sweep(); const b = z.object({ candidateId: z.string().uuid(), assessmentId: z.string().uuid(), validDays: z.number().int().min(1).max(14).default(7), sendEmail: z.boolean().default(false) }).parse(req.body);
    const candidate = candidateFor(req.user, b.candidateId), assessment = one('SELECT * FROM assessments WHERE id=?', b.assessmentId);
    if (!assessment || assessment.job_id !== candidate.job_id) throw fail(400, '请选择该候选人岗位对应的测评方案');
    if (one(`SELECT id FROM exams WHERE candidate_id=? AND status IN ('invited','in_progress')`, candidate.id)) throw fail(409, '该候选人已有有效测评，请先撤销旧邀请');
    const questions = json(assessment.question_ids, []).map(key => one('SELECT * FROM questions WHERE id=? AND active=1', key));
    if (!questions.length || questions.some(q => !q)) throw fail(400, '方案中有已停用的题目，请先编辑方案');
    if (assessment.randomize) shuffle(questions);
    const key = id(), raw = token(), time = now(), expires = new Date(Date.now() + b.validDays * 86400000).toISOString();
    transaction(db, () => {
      run('INSERT INTO exams(id,candidate_id,assessment_id,name,questions,duration,allow_ai,record_switch,token_hash,status,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', key, candidate.id, assessment.id, assessment.name, JSON.stringify(questions.map(q => ({ id: q.id, title: q.title, competency: q.competency, type: q.type, minutes: q.minutes, rubric: q.rubric }))), assessment.duration, assessment.allow_ai, assessment.record_switch, digest(raw), 'invited', expires, time);
      run('UPDATE exams SET prior_stage=? WHERE id=?', candidate.stage, key);
      applyExamStage(db, one('SELECT * FROM exams WHERE id=?', key), 'exam.invite', req.user.id); audit(db, req.user.id, 'exam.invite', key);
    });
    let mailStatus = 'not_sent', mailError = '';
    if (b.sendEmail) { try { mailStatus = await deliverInvitation(one('SELECT * FROM exams WHERE id=?', key), candidate, raw); } catch (error) { mailStatus = 'failed'; mailError = error.message; run(`UPDATE exams SET mail_status='failed' WHERE id=?`, key); } }
    res.status(201).json({ id: key, inviteUrl: config.appUrl + '/#/invite/' + raw, mailStatus, mailError });
  });
  app.post('/api/exams/:id/send', staff, hr, async (req, res) => {
    const { inviteToken } = z.object({ inviteToken: required(100) }).parse(req.body), exam = examFor(req.user, req.params.id);
    if (exam.status !== 'invited' || digest(inviteToken) !== exam.token_hash) throw fail(400, '链接无效或测评已开始');
    limit(db, 'mail:' + req.user.id, 30, 3600000);
    const mailStatus = await deliverInvitation(exam, candidateFor(req.user, exam.candidate_id), inviteToken); audit(db, req.user.id, 'exam.email', exam.id); res.json({ mailStatus });
  });
  app.post('/api/exams/:id/revoke', staff, hr, (req, res) => {
    const exam = examFor(req.user, req.params.id);
    if (!['invited', 'in_progress'].includes(exam.status)) throw fail(409, '只有待开始和进行中的测评可以撤销');
    transaction(db, () => { run(`UPDATE exams SET status='revoked',revision=revision+1 WHERE id=?`, exam.id); run('DELETE FROM portal_sessions WHERE exam_id=?', exam.id); applyExamStage(db, exam, 'exam.revoke', req.user.id); audit(db, req.user.id, 'exam.revoke', exam.id); }); res.json({ ok: true });
  });
  app.get('/api/exams/:id', staff, (req, res) => {
    const exam = examFor(req.user, req.params.id);
    const detail = { ...cleanExam(exam), questions: exam.status === 'submitted' ? json(exam.questions, []) : [], answers: exam.status === 'submitted' ? json(exam.answers, {}) : {}, usedAI: Boolean(exam.used_ai), allowAI: Boolean(exam.allow_ai), recordSwitch: Boolean(exam.record_switch), switchCount: one('SELECT count(*) AS count FROM exam_events WHERE exam_id=?', exam.id).count, reviews: reviewRows(exam.id), consentAt: exam.consent_at };
    if (req.user.role === 'department') { detail.answers = Object.fromEntries(Object.entries(detail.answers).map(([key, value]) => [key, redact(value)])); detail.reviews = detail.reviews.map(r => ({ ...r, note: redact(r.note) })); }
    res.json(detail);
  });
  app.put('/api/exams/:id/review', staff, (req, res) => {
    const exam = examFor(req.user, req.params.id);
    if (exam.status !== 'submitted') throw fail(409, '测评提交后才可复核');
    if (exam.feedback) throw fail(409, '请 HR 先撤回已发布反馈，再修改复核');
    const b = z.object({ version: z.number().int().min(0), ratings: z.record(z.string().uuid(), z.number().int().min(1).max(5)), recommendation: z.enum(['建议面试', '建议补充考察', '不建议推进']), note: required(5000) }).parse(req.body);
    const questions = json(exam.questions, []);
    if (Object.keys(b.ratings).length !== questions.length || questions.some(q => !b.ratings[q.id])) throw fail(400, '请对本次测评的每道题评分');
    const existing = one('SELECT version FROM reviews WHERE exam_id=? AND user_id=?', exam.id, req.user.id);
    if ((existing?.version ?? 0) !== b.version) throw fail(409, '复核已在其他窗口更新，请刷新后重试');
    run('INSERT INTO reviews(id,exam_id,user_id,ratings,recommendation,note,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(exam_id,user_id) DO UPDATE SET ratings=excluded.ratings,recommendation=excluded.recommendation,note=excluded.note,updated_at=excluded.updated_at,version=reviews.version+1', id(), exam.id, req.user.id, JSON.stringify(b.ratings), b.recommendation, b.note, now());
    audit(db, req.user.id, 'exam.review', exam.id); res.json({ ok: true });
  });
  app.post('/api/exams/:id/feedback', staff, hr, (req, res) => {
    const { message } = z.object({ message: required(5000) }).parse(req.body), exam = examFor(req.user, req.params.id), reviews = reviewRows(exam.id);
    if (exam.feedback) throw fail(409, '反馈已发布，请先撤回再重新发布');
    if (exam.status !== 'submitted' || !reviews.length) throw fail(409, '测评须已提交并完成至少一份完整人工复核');
    const ratings = reviews.flatMap(r => Object.values(r.ratings)), score = Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length * 20);
    run('UPDATE exams SET feedback=? WHERE id=?', JSON.stringify({ message, score, publishedAt: now(), basis: '人工逐题评分的平均值换算为百分制' }), exam.id);
    audit(db, req.user.id, 'feedback.publish', exam.id); res.json({ ok: true });
  });
  app.delete('/api/exams/:id/feedback', staff, hr, (req, res) => { const exam = examFor(req.user, req.params.id); run('UPDATE exams SET feedback=NULL WHERE id=?', exam.id); audit(db, req.user.id, 'feedback.retract', exam.id); res.json({ ok: true }); });
  app.get('/api/admin', staff, admin, (req, res) => res.json({ users: all('SELECT * FROM users ORDER BY created_at').map(publicUser), audit: all('SELECT a.*,u.name AS actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200') }));
  app.post('/api/admin/users', staff, admin, async (req, res) => {
    const b = z.object({ name: required(100), email, password, role: z.enum(['admin', 'hr', 'department']), department: text(100) }).parse(req.body);
    if (b.role === 'department' && !b.department) throw fail(400, '部门账号必须填写所属部门');
    const key = id(), hash = await hashPassword(b.password);
    transaction(db, () => {
      const actor = currentStaff(req); if (!actor || actor.role !== 'admin' || actor.must_change) throw fail(403, '管理员会话已失效，请重新登录');
      if (one('SELECT id FROM users WHERE email=?', b.email)) throw fail(409, '邮箱已被使用');
      run('INSERT INTO users(id,name,email,password_hash,role,department,created_at) VALUES(?,?,?,?,?,?,?)', key, b.name, b.email, hash, b.role, b.department, now()); audit(db, actor.id, 'user.create', key);
    }); res.status(201).json({ id: key });
  });
  app.patch('/api/admin/users/:id', staff, admin, async (req, res) => {
    const b = z.object({ active: z.boolean().optional(), password: password.optional() }).refine(b => b.active !== undefined || b.password).parse(req.body);
    const hash = b.password ? await hashPassword(b.password) : null;
    transaction(db, () => {
      const actor = currentStaff(req); if (!actor || actor.role !== 'admin' || actor.must_change) throw fail(403, '管理员会话已失效，请重新登录');
      const user = one('SELECT * FROM users WHERE id=?', req.params.id);
      if (!user) throw fail(404, '账号不存在');
      if (user.id === actor.id && b.active === false) throw fail(400, '不能停用当前登录账号');
      if (user.role === 'admin' && user.active && b.active === false && one("SELECT count(*) AS count FROM users WHERE role='admin' AND active=1").count <= 1) throw fail(400, '必须保留一名有效管理员');
      if (b.active !== undefined) run('UPDATE users SET active=? WHERE id=?', +b.active, user.id);
      if (hash) run('UPDATE users SET password_hash=?,must_change=1 WHERE id=?', hash, user.id);
      run('DELETE FROM sessions WHERE user_id=?', user.id); audit(db, req.user.id, hash ? 'user.reset' : 'user.active', user.id);
    }); res.json({ ok: true });
  });
  function portalView(exam) {
    const candidate = one('SELECT name FROM candidates WHERE id=?', exam.candidate_id);
    const result = { ...cleanExam(exam), candidateName: candidate.name, company: config.company, allowAI: Boolean(exam.allow_ai), recordSwitch: Boolean(exam.record_switch), serverTime: now(), questionCount: json(exam.questions, []).length };
    delete result.candidateId; delete result.assessmentId; delete result.mailStatus;
    if (['in_progress', 'submitted'].includes(exam.status)) Object.assign(result, { questions: json(exam.questions, []).map(({ rubric, ...question }) => question), answers: json(exam.answers, {}), revision: exam.revision, usedAI: Boolean(exam.used_ai) });
    return result;
  }
  const portal = (req, res, next) => {
    sweep(); const raw = cookieValue(req, 'td_portal');
    req.exam = raw ? one('SELECT e.* FROM exams e JOIN portal_sessions s ON s.exam_id=e.id WHERE s.hash=? AND s.expires_at>?', digest(raw), now()) : null;
    if (!req.exam || ['revoked', 'expired'].includes(req.exam.status)) return next(fail(401, '测评会话已失效，请使用有效邀请链接进入'));
    const expected = z.string().uuid().parse(req.get('X-Exam-Id'));
    if (expected !== req.exam.id) return next(Object.assign(fail(409, '此浏览器已切换到另一份测评。当前草稿已保留，请下载副本并使用本次邀请重新进入。'), { code: 'PORTAL_CONTEXT_MISMATCH' }));
    next();
  };
  app.post('/api/portal/redeem', (req, res) => {
    limit(db, 'redeem:' + req.ip, 60, 15 * 60000); sweep();
    const b = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).parse(req.body), exam = one('SELECT * FROM exams WHERE token_hash=?', digest(b.token));
    if (!exam || ['revoked', 'expired'].includes(exam.status) || (exam.submitted_at && Date.parse(exam.submitted_at) + 30 * 86400000 < Date.now())) throw fail(410, '邀请不存在、已过期或已撤销，请联系 HR');
    const raw = token(); run('INSERT INTO portal_sessions VALUES(?,?,?)', digest(raw), exam.id, new Date(Date.now() + 7 * 86400000).toISOString());
    setCookie(res, config, 'td_portal', raw, 7 * 86400000, '/api/portal'); res.json(portalView(exam));
  });
  app.get('/api/portal/me', portal, (req, res) => res.json(portalView(req.exam)));
  app.post('/api/portal/logout', portal, (req, res) => { run('DELETE FROM portal_sessions WHERE hash=?', digest(cookieValue(req, 'td_portal'))); setCookie(res, config, 'td_portal', '', 0, '/api/portal'); res.json({ ok: true }); });
  app.post('/api/portal/start', portal, (req, res) => {
    z.object({ consent: z.literal(true) }).parse(req.body);
    if (req.exam.status !== 'invited') throw fail(409, '测评已经开始或已经结束，请刷新');
    const time = now(), deadline = new Date(Date.now() + req.exam.duration * 60000).toISOString();
    transaction(db, () => {
      run(`UPDATE exams SET status='in_progress',started_at=?,deadline_at=?,consent_at=? WHERE id=? AND status='invited'`, time, deadline, time, req.exam.id);
      applyExamStage(db, req.exam, 'exam.start', 'candidate'); audit(db, 'candidate', 'exam.start', req.exam.id);
    }); res.json(portalView(one('SELECT * FROM exams WHERE id=?', req.exam.id)));
  });
  function saveAnswers(req, submit) {
    const b = (submit ? answerSchema.extend({ usedAI: z.boolean() }) : answerSchema).parse(req.body), exam = req.exam;
    if (exam.status !== 'in_progress') throw fail(409, '测评已经结束；超时仅保留截止前成功保存的内容');
    const keys = new Set(json(exam.questions, []).map(q => q.id));
    if (Object.keys(b.answers).some(key => !keys.has(key)) || Object.values(b.answers).reduce((sum, value) => sum + value.length, 0) > 500000) throw fail(400, '答案内容超过限制或含有无效题号');
    transaction(db, () => {
      const changed = run('UPDATE exams SET answers=?,revision=revision+1,status=?,submitted_at=?,used_ai=? WHERE id=? AND revision=? AND status=?', JSON.stringify(b.answers), submit ? 'submitted' : 'in_progress', submit ? now() : null, b.usedAI === undefined ? exam.used_ai : +b.usedAI, exam.id, b.revision, 'in_progress');
      if (!changed.changes) throw fail(409, '另一窗口已保存新版本，请先复制当前答案再刷新，避免覆盖');
      if (submit) { applyExamStage(db, exam, 'exam.submit', 'candidate'); audit(db, 'candidate', 'exam.submit', exam.id); }
    }); return portalView(one('SELECT * FROM exams WHERE id=?', exam.id));
  }
  app.put('/api/portal/answers', portal, (req, res) => res.json(saveAnswers(req, false)));
  app.post('/api/portal/submit', portal, (req, res) => res.json(saveAnswers(req, true)));
  app.post('/api/portal/events', portal, (req, res) => {
    const { eventId } = z.object({ eventId: z.string().uuid() }).parse(req.body);
    if (req.exam.status === 'in_progress' && req.exam.record_switch) {
      const count = one('SELECT count(*) AS count FROM exam_events WHERE exam_id=?', req.exam.id).count;
      if (count < 1000) run('INSERT OR IGNORE INTO exam_events VALUES(?,?,?)', eventId, req.exam.id, now());
    } res.json({ ok: true });
  });
  app.use('/api', (req, res, next) => next(fail(404, '接口不存在')));
  const dist = path.resolve('dist');
  if (existsSync(path.join(dist, 'index.html'))) { app.use(express.static(dist, { index: false, maxAge: config.env === 'production' ? '1h' : 0 })); app.get('/{*path}', (req, res) => res.sendFile(path.join(dist, 'index.html'))); }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof ZodError) return res.status(400).json({ error: '输入格式不正确，请检查必填项、长度和数值范围', fields: error.issues.map(i => i.path.join('.')).slice(0, 10) });
    if (error instanceof multer.MulterError) return res.status(400).json({ error: '上传失败：仅支持单个不超过 10 MB 的简历文件' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: '请求内容过大，请缩短文字或答案' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: '请求内容不是有效 JSON' });
    const status = error.status >= 400 && error.status <= 599 ? error.status : 500;
    if (status === 500) console.error('request_failed', req.method, req.route?.path ?? 'unknown', error.code ?? error.name);
    res.status(status).json({ error: status === 500 ? '服务暂时无法完成请求，请重试或联系管理员' : error.message, ...(error.code === 'PORTAL_CONTEXT_MISMATCH' ? { code: error.code } : {}) });
  });
  return { app, db, config, sweep, close: () => db.close() };
}
