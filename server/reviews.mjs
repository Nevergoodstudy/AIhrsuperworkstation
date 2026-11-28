import { z } from 'zod';
import { json, transaction } from './db.mjs';
import { audit, digest, fail, id, now, redact } from './security.mjs';

const text = max => z.string().trim().max(max);
const required = max => text(max).min(1);
const uuid = z.string().uuid();
const version = z.number().int().nonnegative();
const ratingSchema = z.object({
  version,
  taskId: uuid.optional(),
  ratings: z.record(uuid, z.number().int().min(1).max(5)),
  recommendation: z.enum(['建议面试', '建议补充考察', '不建议推进']),
  note: text(5000),
  intent: z.enum(['draft', 'submit']).default('submit')
});
const reviewerSettings = { ownerId: uuid, reviewerIds: z.array(uuid).min(1).max(10) };
const planSchema = z.object({ version, ...reviewerSettings, dueAt: z.iso.datetime(), reason: required(500) });
const policySchema = z.discriminatedUnion('enabled', [
  z.object({ version, enabled: z.literal(false) }),
  z.object({ version, enabled: z.literal(true), ...reviewerSettings, dueHours: z.number().int().min(1).max(720) })
]);
const addHours = (time, hours) => new Date(Date.parse(time) + hours * 3600000).toISOString();
const decisionSchema = z.object({
  version: version.positive(),
  outcome: z.enum(['进入面试', '补充考察', '停止推进']),
  reason: required(5000),
  evidence: z.array(z.object({ questionId: uuid, rationale: required(1000) })).min(1).max(50),
  disagreement: text(5000).default('')
});
const isHr = user => user.role === 'hr' || user.role === 'admin';

export function createReviewWorkflow(db) {
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const planFor = examId => one('SELECT * FROM review_plans WHERE exam_id=?', examId);
  const assignments = examId => all(`
    SELECT t.*, u.name AS reviewer, u.active AS user_active, u.role, u.department
    FROM review_tasks t JOIN users u ON u.id=t.user_id
    WHERE t.exam_id=? AND t.active=1 ORDER BY u.name, t.id
  `, examId);
  const eligible = (task, department) => task.user_active && (isHr(task) || task.department === department);

  function record(examId, userId, action, details) {
    run('INSERT INTO review_workflow_events(exam_id,actor_id,action,details,created_at) VALUES(?,?,?,?,?)',
      examId, userId, action, JSON.stringify(details), now());
    audit(db, userId, action, examId);
  }

  function legacyReviews(examId) {
    return all(`
      SELECT r.*, u.name AS reviewer FROM reviews r JOIN users u ON u.id=r.user_id
      WHERE r.exam_id=? ORDER BY r.updated_at DESC, r.id
    `, examId).map(row => reviewView(row));
  }

  function reviewView(row, departmentViewer = false) {
    return {
      id: row.id, userId: row.user_id, reviewer: row.reviewer,
      ratings: json(row.ratings, {}), recommendation: row.recommendation,
      note: departmentViewer ? redact(row.note) : row.note, updatedAt: row.updated_at, version: row.version
    };
  }

  function scopeExam(exam, user) {
    if (isHr(user) || !planFor(exam.id)) return;
    if (!one('SELECT 1 FROM review_tasks WHERE exam_id=? AND user_id=? AND active=1', exam.id, user.id)) {
      throw fail(404, '测评不存在或无访问权限');
    }
  }

  function state(exam, user, department) {
    const plan = planFor(exam.id);
    if (!plan) {
      const reviews = legacyReviews(exam.id);
      const visible = exam.feedback || reviews.some(review => review.userId === user.id) ? reviews : [];
      return {
        reviews: isHr(user) ? reviews : visible.map(review => ({ ...review, note: redact(review.note) })),
        workflow: null,
        canReview: exam.status === 'submitted' && !exam.feedback
      };
    }
    const tasks = assignments(exam.id);
    const mine = tasks.find(task => task.user_id === user.id);
    const ready = tasks.length > 0 && tasks.every(task => task.submitted_at && eligible(task, department));
    const feedbackRecord = isHr(user) ? one(`
      SELECT details, created_at FROM review_workflow_events
      WHERE exam_id=? AND action='feedback.publish' ORDER BY id DESC LIMIT 1
    `, exam.id) : null;
    return {
      reviews: tasks.filter(task => task.submitted_at && (ready || task.user_id === user.id))
        .map(task => reviewView(task, !isHr(user))),
      workflow: {
        dueAt: plan.due_at, dueHours: plan.due_hours, version: plan.version, required: tasks.length,
        submitted: tasks.filter(task => task.submitted_at).length,
        canPublish: isHr(user) && ready && exam.status === 'submitted' && !exam.feedback,
        mine: mine ? { ...reviewView(mine), submittedAt: mine.submitted_at } : null,
        ...(isHr(user) ? {
          ownerId: plan.owner_id,
          ownerName: one('SELECT name FROM users WHERE id=?', plan.owner_id).name,
          assignments: tasks.map(task => ({
            id: task.id, userId: task.user_id, reviewer: task.reviewer, submittedAt: task.submitted_at,
            version: task.version, eligible: Boolean(eligible(task, department))
          })),
          lastPublication: feedbackRecord ? { ...json(feedbackRecord.details), publishedAt: feedbackRecord.created_at } : null
        } : {})
      },
      canReview: Boolean(mine && !mine.submitted_at && !exam.feedback && exam.status === 'submitted')
    };
  }

  function options(department) {
    return all(`
      SELECT id, name, role FROM users WHERE active=1
      AND (role IN ('admin','hr') OR (role='department' AND department=?))
      ORDER BY name, id
    `, department);
  }

  function checkReviewers(department, settings) {
    const { ownerId, reviewerIds } = settings;
    if (new Set(reviewerIds).size !== reviewerIds.length) throw fail(400, '评审人不能重复');
    const people = new Map(options(department).map(person => [person.id, person]));
    const owner = people.get(ownerId);
    if (!owner || !isHr(owner)) throw fail(400, '请选择有效的 HR 或管理员作为负责人');
    if (reviewerIds.some(userId => !people.has(userId))) throw fail(400, '评审人须为有效的内部账号，部门评审须与岗位部门一致');
  }

  function jobPolicy(jobId) {
    const row = one('SELECT * FROM job_review_policies WHERE job_id=?', jobId);
    return row ? { enabled: Boolean(row.enabled), version: row.version, ...json(row.settings) } : { enabled: false, version: 0 };
  }

  function configureJob(job, user, input) {
    const { version: expected, enabled, ...settings } = policySchema.parse(input);
    transaction(db, () => {
      if (jobPolicy(job.id).version !== expected) throw fail(409, '岗位评审默认安排已更新，请刷新');
      if (enabled) checkReviewers(job.department, settings);
      run(`
        INSERT INTO job_review_policies(job_id,enabled,settings,version) VALUES(?,?,?,1)
        ON CONFLICT(job_id) DO UPDATE SET enabled=excluded.enabled,settings=excluded.settings,version=job_review_policies.version+1
      `, job.id, +enabled, JSON.stringify(settings));
      audit(db, user.id, enabled ? 'review.policy.enable' : 'review.policy.disable', job.id);
    });
  }

  function addTask(examId, userId) {
    run('INSERT INTO review_tasks(id,exam_id,user_id,updated_at) VALUES(?,?,?,?)', id(), examId, userId, now());
  }

  // Invitation and its required review assignments commit together.
  function assignFromJob(examId, job, user, expiresAt) {
    const policy = jobPolicy(job.id);
    if (!policy.enabled) return;
    checkReviewers(job.department, policy);
    run('INSERT INTO review_plans(exam_id,owner_id,due_at,due_hours) VALUES(?,?,?,?)',
      examId, policy.ownerId, addHours(expiresAt, policy.dueHours), policy.dueHours);
    for (const userId of policy.reviewerIds) addTask(examId, userId);
    record(examId, user.id, 'review.assign', {
      source: 'job', policyVersion: policy.version, ownerId: policy.ownerId,
      reviewerIds: policy.reviewerIds, dueHours: policy.dueHours
    });
  }

  function startReviewDeadline(examId, submittedAt) {
    const plan = planFor(examId);
    if (!plan?.due_hours) return;
    run('UPDATE review_plans SET due_at=?,due_hours=NULL,version=version+1 WHERE exam_id=?',
      addHours(submittedAt, plan.due_hours), examId);
  }

  function configure(exam, user, department, input) {
    const body = planSchema.parse(input);
    if (!['invited', 'in_progress', 'submitted'].includes(exam.status) || exam.feedback) {
      throw fail(409, '当前测评无法调整评审安排');
    }
    const dueAt = new Date(body.dueAt).toISOString();
    if (dueAt <= now()) throw fail(400, '请选择未来的复核期限');
    transaction(db, () => {
      const plan = planFor(exam.id);
      if ((plan?.version ?? 0) !== body.version) throw fail(409, '评审安排已更新，请刷新');
      if (!plan && one('SELECT 1 FROM reviews WHERE exam_id=? LIMIT 1', exam.id)) throw fail(409, '已有历史复核，请按原流程处理');
      checkReviewers(department, body);
      const previous = plan ? assignments(exam.id) : [];
      run(`
        INSERT INTO review_plans(exam_id, owner_id, due_at) VALUES(?,?,?)
        ON CONFLICT(exam_id) DO UPDATE SET owner_id=excluded.owner_id, due_at=excluded.due_at, due_hours=NULL, version=review_plans.version+1
      `, exam.id, body.ownerId, dueAt);
      for (const task of previous.filter(task => !body.reviewerIds.includes(task.user_id))) {
        run('UPDATE review_tasks SET active=0 WHERE id=?', task.id);
      }
      for (const userId of body.reviewerIds.filter(userId => !previous.some(task => task.user_id === userId))) {
        addTask(exam.id, userId);
      }
      record(exam.id, user.id, plan ? 'review.reassign' : 'review.assign', {
        reason: body.reason, before: plan ? { ownerId: plan.owner_id, dueAt: plan.due_at, reviewerIds: previous.map(task => task.user_id) } : null,
        after: { ownerId: body.ownerId, dueAt, reviewerIds: body.reviewerIds }
      });
    });
  }

  function save(exam, user, input) {
    if (exam.status !== 'submitted' || exam.feedback) throw fail(409, '仅可复核已提交且尚未发布反馈的答卷');
    const body = ratingSchema.parse(input);
    const questions = json(exam.questions, []);
    if (Object.keys(body.ratings).some(key => !questions.some(question => question.id === key))) {
      throw fail(400, '评分中包含不属于本答卷的题目');
    }
    if (body.intent === 'submit' && (!body.note || questions.some(question => !body.ratings[question.id]))) {
      throw fail(400, '请对每道题评分并填写复核说明');
    }
    transaction(db, () => {
      if (planFor(exam.id)) {
        const task = one('SELECT id,version,submitted_at FROM review_tasks WHERE exam_id=? AND user_id=? AND active=1', exam.id, user.id);
        if (!task) throw fail(403, '仅指定评审人可以填写复核');
        if (task.id !== body.taskId || task.version !== body.version || task.submitted_at) throw fail(409, '复核已更新或已经提交，请刷新');
        const time = now();
        run('UPDATE review_tasks SET ratings=?,recommendation=?,note=?,updated_at=?,submitted_at=?,version=version+1 WHERE id=?',
          JSON.stringify(body.ratings), body.recommendation, body.note, time, body.intent === 'submit' ? time : null, task.id);
        if (body.intent === 'submit') run('UPDATE review_plans SET version=version+1 WHERE exam_id=?', exam.id);
        record(exam.id, user.id, body.intent === 'submit' ? 'review.submit' : 'review.draft', { taskId: task.id });
        return;
      }
      if (body.intent !== 'submit') throw fail(400, '历史流程只接受完整复核');
      const prior = one('SELECT version FROM reviews WHERE exam_id=? AND user_id=?', exam.id, user.id);
      if ((prior?.version ?? 0) !== body.version) throw fail(409, '复核已在其他窗口更新，请刷新后重试');
      run(`
        INSERT INTO reviews(id,exam_id,user_id,ratings,recommendation,note,updated_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(exam_id,user_id) DO UPDATE SET ratings=excluded.ratings,recommendation=excluded.recommendation,
        note=excluded.note,updated_at=excluded.updated_at,version=reviews.version+1
      `, id(), exam.id, user.id, JSON.stringify(body.ratings), body.recommendation, body.note, now());
      audit(db, user.id, 'exam.review', exam.id);
    });
  }

  function reopen(exam, user, input) {
    const body = z.object({ taskId: uuid, version: version.positive(), reason: required(500) }).parse(input);
    if (exam.status !== 'submitted' || exam.feedback) throw fail(409, '请先撤回反馈，再重新打开复核');
    transaction(db, () => {
      const task = one('SELECT * FROM review_tasks WHERE id=? AND exam_id=? AND active=1', body.taskId, exam.id);
      if (!task || task.version !== body.version || !task.submitted_at) throw fail(409, '复核状态已经变化，请刷新');
      run('UPDATE review_tasks SET submitted_at=NULL,version=version+1,updated_at=? WHERE id=?', now(), task.id);
      run('UPDATE review_plans SET version=version+1 WHERE exam_id=?', exam.id);
      record(exam.id, user.id, 'review.reopen', { taskId: task.id, reason: body.reason });
    });
  }

  function publish(exam, user, job, input) {
    const { message, decision } = z.object({ message: required(5000), decision: decisionSchema.optional() }).parse(input);
    if (exam.status !== 'submitted' || exam.feedback) throw fail(409, '仅可为已提交且尚未发布反馈的测评发布');
    transaction(db, () => {
      const plan = planFor(exam.id);
      const tasks = plan ? assignments(exam.id) : legacyReviews(exam.id);
      if (!tasks.length || (plan && tasks.some(task => !task.submitted_at || !eligible(task, job.department)))) {
        throw fail(409, '请先完成全部必要复核，并处理失效的评审分配');
      }
      const reviews = plan ? tasks.map(task => reviewView(task)) : tasks;
      if (plan) {
        if (!decision) throw fail(400, '请填写招聘决定及依据');
        if (decision.version !== plan.version) throw fail(409, '评审安排已更新，请刷新');
        const questionIds = new Set(json(exam.questions, []).map(question => question.id));
        if (decision.evidence.some(item => !questionIds.has(item.questionId))) throw fail(400, '判断依据须关联本次答卷题目');
        if (new Set(reviews.map(review => review.recommendation)).size > 1 && !decision.disagreement) {
          throw fail(400, '请说明如何处理评审分歧');
        }
      }
      const ratings = reviews.flatMap(review => Object.values(review.ratings));
      const score = Math.round(ratings.reduce((total, rating) => total + rating, 0) / ratings.length * 20);
      const feedback = { message, score, publishedAt: now(), basis: '人工逐题评分的平均值换算为百分制' };
      run('UPDATE exams SET feedback=? WHERE id=?', JSON.stringify(feedback), exam.id);
      if (plan) {
        record(exam.id, user.id, 'feedback.publish', {
          decision, job: { id: job.id, version: job.version, requirements: job.requirements },
          reviews: reviews.map(({ id, version, ratings, recommendation }) => ({ id, version, ratings, recommendation })),
          feedback
        });
        return;
      }
      audit(db, user.id, 'feedback.publish', exam.id);
    });
  }

  function retract(exam, user) {
    if (!exam.feedback) return;
    transaction(db, () => {
      run('UPDATE exams SET feedback=NULL WHERE id=?', exam.id);
      run('DELETE FROM feedback_links WHERE exam_id=?', exam.id);
      if (planFor(exam.id)) {
        const publication = one("SELECT id FROM review_workflow_events WHERE exam_id=? AND action='feedback.publish' ORDER BY id DESC LIMIT 1", exam.id);
        record(exam.id, user.id, 'feedback.retract', { publicationId: publication.id });
        return;
      }
      audit(db, user.id, 'feedback.retract', exam.id);
    });
  }

  function tasksFor(user, cursorQuery) {
    const cursor = z.object({ dueAt: z.iso.datetime(), examId: uuid }).optional()
      .parse(cursorQuery.dueAt !== undefined || cursorQuery.examId !== undefined ? cursorQuery : undefined);
    const pageSize = 100;
    const rows = all(`
      SELECT e.id AS examId, e.name AS examName, c.name AS candidateName, p.due_at AS dueAt,
        CASE WHEN EXISTS (
          SELECT 1 FROM review_tasks m WHERE m.exam_id=e.id AND m.user_id=? AND m.active=1 AND m.submitted_at IS NULL
        ) THEN 'review' ELSE 'follow-up' END AS action
      FROM review_plans p JOIN exams e ON p.exam_id=e.id JOIN candidates c ON e.candidate_id=c.id JOIN jobs j ON c.job_id=j.id
      WHERE e.status='submitted' AND e.feedback IS NULL
        AND (? <> 'department' OR j.department=?)
        AND ((? <> 'department' AND p.owner_id=?) OR EXISTS (
          SELECT 1 FROM review_tasks t WHERE t.exam_id=e.id AND t.user_id=? AND t.active=1 AND t.submitted_at IS NULL
        ))
        ${cursor ? 'AND (p.due_at, e.id) > (?,?)' : ''}
      ORDER BY p.due_at, e.id LIMIT ?
    `, user.id, user.role, user.department, user.role, user.id, user.id,
    ...(cursor ? [cursor.dueAt, cursor.examId] : []), pageSize + 1);
    const tasks = rows.slice(0, pageSize);
    const last = tasks.at(-1);
    return { tasks, nextCursor: rows.length > pageSize ? { dueAt: last.dueAt, examId: last.examId } : null };
  }

  function pilotRows(jobId, from, until) {
    const rows = all(`
      SELECT e.id, e.submitted_at, e.feedback, p.due_at,
        (SELECT details FROM review_workflow_events w WHERE w.exam_id=e.id AND w.action='review.assign' ORDER BY id LIMIT 1) AS original_plan,
        (SELECT min(created_at) FROM review_workflow_events w WHERE w.exam_id=e.id AND w.action='feedback.publish') AS first_decision
      FROM candidates c JOIN exams e ON e.candidate_id=c.id
      LEFT JOIN review_plans p ON p.exam_id=e.id
      WHERE c.job_id=? AND e.status='submitted' AND e.submitted_at>=? AND e.submitted_at<=?
      ORDER BY e.submitted_at, e.id
    `, jobId, from, until);
    return rows.map(row => {
      const original = json(row.original_plan);
      const originalDue = original?.dueHours ? addHours(row.submitted_at, original.dueHours) : original?.after?.dueAt;
      const nudges = one(`
        SELECT count(*) AS count FROM exam_operational_events
        WHERE exam_id=? AND action='review.nudge' AND created_at>=? AND created_at<=?
      `, row.id, row.submitted_at, row.first_decision ?? now()).count;
      const common = [row.id, row.submitted_at, originalDue, row.due_at, row.first_decision, nudges];
      if (!row.feedback) return [...common, '', '', '', ''];
      const feedbackHash = digest(row.feedback);
      const notices = all(`
        SELECT action, min(created_at) AS at FROM exam_operational_events
        WHERE exam_id=? AND action IN ('feedback.notice.manual','feedback.notice.confirmed')
          AND json_extract(details,'$.feedbackHash')=? GROUP BY action
      `, row.id, feedbackHash);
      const access = one('SELECT first_access_at FROM feedback_access_events WHERE exam_id=? AND feedback_hash=?', row.id, feedbackHash);
      return [...common, json(row.feedback).publishedAt, notices.find(item => item.action === 'feedback.notice.manual')?.at,
        access?.first_access_at, notices.find(item => item.action === 'feedback.notice.confirmed')?.at];
    });
  }

  return { scopeExam, state, options, configure, save, reopen, publish, retract, tasksFor, jobPolicy, configureJob, assignFromJob, startReviewDeadline, pilotRows };
}
