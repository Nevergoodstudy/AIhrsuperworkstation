import { id, now } from './security.mjs';

// Call inside the same transaction as the exam/candidate mutation.
export function recordStageEvent(db, candidate, stage, source, actorId, reason, examId = null) {
  db.prepare('INSERT INTO candidate_events VALUES(?,?,?,?,?,?,?,?,?)').run(id(), candidate.id, examId, candidate.stage, stage, source, actorId, reason, now());
}

export function applyExamStage(db, exam, source, actorId) {
  const candidate = db.prepare('SELECT * FROM candidates WHERE id=?').get(exam.candidate_id);
  if (!candidate) return;
  let stage = candidate.stage, owner = candidate.stage_exam_id, reason;
  if (source === 'exam.invite' && ['待筛选', '待测评', '待复核'].includes(candidate.stage)) {
    stage = '待测评'; owner = exam.id; reason = 'HR 发起测评，记录邀请前阶段并建立自动阶段归属';
  } else if (owner === exam.id) {
    if (source === 'exam.start' && stage === '待测评') {
      stage = '测评中'; reason = '候选人已同意规则并开始本次测评';
    } else if (['exam.submit', 'exam.timeout'].includes(source) && stage === '测评中') {
      stage = '待复核'; owner = null; reason = source === 'exam.timeout' ? '服务器截止，只提交已保存答案' : '候选人提交本次测评';
    } else if (['exam.revoke', 'exam.expire'].includes(source) && ['待测评', '测评中'].includes(stage) && exam.prior_stage) {
      stage = exam.prior_stage; owner = null; reason = '本次测评结束，恢复已记录的邀请前阶段';
    }
  }
  reason ??= '保留人工阶段或历史未知归属，本次考试事件不调整招聘阶段';
  if (stage !== candidate.stage || owner !== candidate.stage_exam_id) {
    db.prepare('UPDATE candidates SET stage=?,stage_exam_id=?,version=version+1,updated_at=? WHERE id=?').run(stage, owner, now(), candidate.id);
  }
  recordStageEvent(db, candidate, stage, source, actorId, reason, exam.id);
}
