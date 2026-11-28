import { useEffect, useState } from 'react';
import { api, date, roles } from './api';
import { Badge, Button, Empty, ErrorBox, Field, Form, Loading, Panel } from './ui';

const followUpLabel = '跟进复核与发布';

export function ReviewTasks({ openExam, refreshKey }) {
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api('/api/review-tasks').then(result => {
      if (active) {
        setTasks(result.tasks);
        setError('');
      }
    }).catch(error => {
      if (active) setError(error);
    });
    return () => { active = false; };
  }, [refreshKey]);

  return <Panel title="我的待办">
    <ErrorBox error={error}/>
    {!tasks && !error && <Loading/>}
    {tasks?.length === 0 && <Empty>当前没有待办。</Empty>}
    {tasks?.length > 0 && <div className="table-scroll"><table className="business-table">
      <thead><tr><th>候选人 / 测评</th><th>下一行动</th><th>复核期限</th></tr></thead>
      <tbody>{tasks.map(task => <tr key={task.examId}>
        <td><strong>{task.candidateName}</strong><small>{task.examName}</small></td>
        <td><button className="text-button" onClick={() => openExam(task.examId)}>
          {task.action === 'review' ? '填写复核' : followUpLabel}
        </button></td>
        <td>{date(task.dueAt)} {Date.parse(task.dueAt) < Date.now() && <Badge warn>已逾期</Badge>}</td>
      </tr>)}</tbody>
    </table></div>}
  </Panel>;
}

export function ReviewPlanForm({ exam, ownerId, save }) {
  const [people, setPeople] = useState(null);
  const [error, setError] = useState('');
  const workflow = exam.workflow;
  useEffect(() => {
    let active = true;
    api('/api/exams/' + exam.id + '/review-options').then(result => {
      if (active) setPeople(result.people);
    }).catch(error => {
      if (active) setError(error);
    });
    return () => { active = false; };
  }, [exam.id]);
  if (error) return <ErrorBox error={error}/>;
  if (!people) return <Loading/>;
  const due = workflow ? new Date(workflow.dueAt) : new Date(Date.now() + 2 * 86400000);
  const dueAt = new Date(due.getTime() - due.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const owners = people.filter(person => person.role !== 'department');
  return <Form initial={{
    ownerId: workflow?.ownerId ?? ownerId, reviewerIds: workflow?.assignments.map(task => task.userId) ?? [], dueAt, reason: ''
  }} fields={[
    { key: 'ownerId', label: '跟进负责人', type: 'select', required: true, options: owners.map(person => ({ value: person.id, label: person.name })) },
    { key: 'dueAt', label: '复核期限（本地时间）', type: 'datetime-local', required: true },
    { key: 'reason', label: '安排或变更原因', maxLength: 500, required: true }
  ]} submit="保存评审安排" onSubmit={async values => {
    await save({ ...values, dueAt: new Date(values.dueAt).toISOString(), version: workflow?.version ?? 0 });
  }}>{(values, change) => <fieldset className="stack">
    <legend>必要评审人</legend>
    {[
      ...people.map(person => ({ id: person.id, label: person.name + ' · ' + roles[person.role] })),
      ...(workflow?.assignments.filter(task => !task.eligible).map(task => ({
        id: task.userId, label: task.reviewer + ' · 失效，请取消并改派'
      })) ?? [])
    ].map(person => <label key={person.id} className="check-line">
      <input type="checkbox" checked={values.reviewerIds.includes(person.id)} onChange={event => {
        change('reviewerIds', event.target.checked
          ? [...values.reviewerIds, person.id]
          : values.reviewerIds.filter(id => id !== person.id));
      }}/>{person.label}
    </label>)}
  </fieldset>}</Form>;
}

export function DecisionForm({ exam, publish }) {
  const disagreement = new Set(exam.reviews.map(review => review.recommendation)).size > 1;
  return <Form initial={{ outcome: '进入面试', reason: '', questionId: '', rationale: '', disagreement: '', message: '' }} fields={[
    { key: 'outcome', label: '招聘决定', type: 'select', options: ['进入面试', '补充考察', '停止推进'] },
    { key: 'reason', label: '决定理由', required: true, type: 'textarea', maxLength: 5000 },
    { key: 'questionId', label: '关联答卷题目', type: 'select', required: true, options: [
      { value: '', label: '请选择题目' },
      ...exam.questions.map((question, index) => ({ value: question.id, label: '第 ' + (index + 1) + ' 题 · ' + question.title.slice(0, 85) }))
    ] },
    { key: 'rationale', label: '这份作答如何支持决定', type: 'textarea', required: true, maxLength: 1000 },
    { key: 'disagreement', label: '评审分歧处理', type: 'textarea', required: disagreement, maxLength: 5000 },
    { key: 'message', label: '向候选人发布的反馈', type: 'textarea', required: true, maxLength: 5000 }
  ]} submit="记录决定并发布反馈" onSubmit={values => publish({
    message: values.message,
    decision: {
      version: exam.workflow.version, outcome: values.outcome, reason: values.reason, disagreement: values.disagreement,
      evidence: [{ questionId: values.questionId, rationale: values.rationale }]
    }
  })}/>;
}

export function WorkflowStatus({ exam, hr, edit, reopen }) {
  const workflow = exam.workflow;
  if (!workflow) return null;
  return <Panel title="评审安排" actions={hr && !exam.feedback && <Button secondary onClick={edit}>调整评审安排</Button>}>
    <div className="stack pad">
      <p>已提交 {workflow.submitted} / {workflow.required} 份 · 期限 {date(workflow.dueAt)}</p>
      {workflow.ownerName && <p>跟进负责人 {workflow.ownerName}</p>}
      {workflow.mine?.submittedAt && <p>我的复核已提交 · {date(workflow.mine.submittedAt)}</p>}
      {workflow.assignments?.map(task => <div key={task.id} className="inline-actions">
        <strong>{task.reviewer}</strong>
        <span>{task.eligible ? (task.submittedAt ? '已提交' : '待提交') : '账号或部门已失效'}</span>
        {task.submittedAt && !exam.feedback && <Button secondary onClick={() => reopen(task)}>重新打开复核</Button>}
      </div>)}
      {workflow.lastPublication && <details>
        <summary>最近记录的决定 · {workflow.lastPublication.decision.outcome} · {date(workflow.lastPublication.publishedAt)}</summary>
        <p className="pre-wrap">{workflow.lastPublication.decision.reason}</p>
        {workflow.lastPublication.decision.evidence.map((item, index) => <p key={index} className="pre-wrap">
          第 {exam.questions.findIndex(question => question.id === item.questionId) + 1} 题 · {item.rationale}
        </p>)}
        {workflow.lastPublication.decision.disagreement && <p className="pre-wrap">分歧处理 · {workflow.lastPublication.decision.disagreement}</p>}
      </details>}
    </div>
  </Panel>;
}

export function FeedbackLinkActions({ issue, revoke }) {
  const [link, setLink] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function update(action) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      if (action === 'issue') {
        setLink(await issue());
        setStatus('新链接已生成，此前发出的结果链接已失效。');
        return;
      }
      await revoke();
      setLink(null);
      setStatus('结果链接已撤销。');
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  return <section className="stack">
    <p className="muted">核实候选人身份后，通过可信渠道分享。链接有效 3 天。</p>
    <div className="inline-actions">
      <Button secondary disabled={busy} onClick={() => update('issue')}>生成或补发只读结果链接</Button>
      <Button secondary disabled={busy} onClick={() => update('revoke')}>撤销结果链接</Button>
    </div>
    {link && <Field label="候选人只读结果链接" hint={'有效期至 ' + date(link.expiresAt)}>
      <input readOnly value={link.url} onFocus={event => event.target.select()}/>
    </Field>}
    {status && <p role="status">{status}</p>}
    <ErrorBox error={error}/>
  </section>;
}
