import { useEffect, useRef, useState } from 'react';
import { Clock3, CheckCircle2, Sprout, Save, Download, LogOut, Send } from 'lucide-react';
import { api, ApiError, date } from './api';
import { Button, ErrorBox, Loading, Panel, Field } from './ui';
let redemption;
function redeem(raw) { if(!redemption || redemption.raw!==raw) redemption={raw,promise:api('/api/portal/redeem',{method:'POST',body:{token:raw}})};return redemption.promise; }
async function portalApi(examId, action = 'me', options = {}) {
  if (!examId) throw new ApiError('请使用您的专属邀请链接重新进入测评。', 400);
  const result = await api('/api/portal/' + action, { ...options, headers: { ...options.headers, 'X-Exam-Id': examId } });
  if (!['events', 'logout'].includes(action) && result.id !== examId) throw new ApiError('测评上下文发生变化，自动保存已暂停，请先下载本地答案副本。', 409, 'PORTAL_CONTEXT_MISMATCH');
  return result;
}
export default function CandidatePortal(){
  const draftGuard=useRef(()=>true);
  const [exam,setExam]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false);
  useEffect(()=>{let live=true;const raw=location.hash.startsWith('#/invite/')?location.hash.slice(9):null;
    const expected = location.hash.match(/^#\/candidate\/([a-f0-9-]{36})$/i)?.[1];
    (raw?redeem(raw):portalApi(expected)).then(result=>{if(!live)return;setExam(result);if(raw){history.replaceState(null,'',location.pathname+location.search+'#/candidate/'+result.id);window.dispatchEvent(new Event('hashchange'));redemption=null;}}).catch(e=>{if(live)setError(e);redemption=null;}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};
  },[]);
  async function refresh(){try{setExam(await portalApi(exam?.id));setError('');}catch(e){setError(e);}}
  return <div className="portal-shell"><header className="portal-header"><span className="brand-mark"><Sprout/></span><div><strong>{exam?.company||'TalentDesk'}</strong><small>候选人测评中心</small></div>{exam&&<Button secondary onClick={async()=>{try{if(!draftGuard.current())return;await portalApi(exam.id,'logout',{method:'POST'});setExam(null);setError('已退出。再次进入请使用您的专属邀请链接。');}catch(e){setError(e);}}}><LogOut size={16}/>退出</Button>}</header><main className="portal-main"><ErrorBox error={error}/>{loading?<Loading/>:exam?.status==='invited'?<section className="portal-intro panel pad stack"><span className="eyebrow">测评邀请</span><h1>{exam.candidateName}，您好</h1><h2>{exam.name}</h2><div className="exam-facts"><div><strong>{exam.questionCount}</strong><span>道业务题目</span></div><div><strong>{exam.duration}</strong><span>分钟限时</span></div></div><p>邀请有效期至 {date(exam.expiresAt)}。点击开始后由服务器计时，刷新、关闭或切换设备都不会重置计时。</p><div className="alert"><strong>请在开始前阅读</strong><ul><li>请独立完成。{exam.allowAI?'本测评允许使用 AI，请如实披露使用情况。':'本测评不允许使用 AI；若实际使用仍需如实披露，由企业人工复核。'}</li><li>答案会自动保存到服务器，请确认页面显示“已保存”。网络断开时请保留页面并及时恢复连接。</li><li>时间结束会提交截止前成功保存的答案，未成功保存的内容无法补交。</li><li>{exam.recordSwitch?'本测评会记录页面隐藏次数，供人工复核参考，不采集其他页面内容，不自动判定作弊。':'本测评不记录切屏行为。'}</li><li>企业将保存作答内容、提交时间和 AI 使用披露，用于本次招聘及人工复核。资料保留期限或删除请求请联系邀请您的 HR。</li><li>专属链接相当于访问凭证，请勿转发。结果反馈由 HR 审核后发布。</li></ul></div>
    <PracticeCheck examId={exam.id}/>
    <label className="check-line"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>我已阅读测评规则，同意企业为本次招聘保存并处理我的测评资料。</label><Button disabled={!consent||busy} onClick={async()=>{setBusy(true);try{setExam(await portalApi(exam.id,'start',{method:'POST',body:{consent:true}}));}catch(e){setError(e);if(e.status===409)await refresh();}finally{setBusy(false);}}}>{busy?'正在开始…':'同意并开始测评'}</Button></section>:exam?.status==='in_progress'?<ExamScreen key={exam.id} initial={exam} onComplete={setExam} draftGuard={draftGuard}/>:exam?.status==='submitted'?<section className="panel pad stack"><CheckCircle2 size={40} color="#168371"/><h1>测评已提交</h1><p>{exam.candidateName}，感谢您完成 {exam.name}。</p><p className="muted">服务器记录的提交时间：{date(exam.submittedAt)}</p>{exam.feedback?<Panel title="企业已发布反馈"><div className="pad stack"><p className="pre-wrap">{exam.feedback.message}</p><strong>人工评分：{exam.feedback.score} / 100</strong><small>{exam.feedback.basis}</small><small>发布时间：{date(exam.feedback.publishedAt)}</small></div></Panel>:<div className="alert">答卷正在等待企业人工复核，HR 发布反馈后可在此查看。</div>}<Button secondary onClick={refresh}>刷新反馈</Button></section>:!error&&<p>请通过企业提供的有效邀请链接进入。</p>}</main><footer className="portal-footer">TalentDesk · 招聘测评 · 如需帮助，请联系邀请您的 HR</footer></div>;
}
function PracticeCheck({ examId }) {
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const checking = status === 'checking';

  async function check(event) {
    event.preventDefault();
    if (checking || !answer.trim()) return;
    setStatus('checking');
    setError('');
    try {
      await portalApi(examId, 'practice', { method: 'POST', body: { answer } });
      setStatus('received');
    } catch (error) {
      setStatus('');
      setError(error.code === 'PORTAL_CONTEXT_MISMATCH' ? '当前邀请已切换，请从本次专属链接重新进入。' : error);
    }
  }

  return (
    <details>
      <summary>开考前试答（可选）</summary>
      <form className="stack" onSubmit={check}>
        <Field label="试答文字" hint="请勿填写个人信息。试答不计分，也不进入正式答卷。">
          <input type="text" maxLength={200} readOnly={checking} value={answer} onChange={event => {
            setAnswer(event.target.value);
            setStatus('');
            setError('');
          }}/>
        </Field>
        <div className="inline-actions">
          <Button secondary type="submit" disabled={checking || !answer.trim()}><Send size={16} aria-hidden="true"/>检查发送</Button>
          <span className="muted" role="status">{checking ? '正在发送…' : status === 'received' ? '服务器已收到试答' : ''}</span>
        </div>
        <ErrorBox error={error}/>
      </form>
    </details>
  );
}
function ExamScreen({initial,onComplete,draftGuard}){
  const [answers,setAnswers]=useState(initial.answers||{}),[usedAI,setUsedAI]=useState(initial.usedAI),[tick,setTick]=useState(Date.now()),[cycle,setCycle]=useState(0),[status,setStatus]=useState('已读取服务器保存的答案'),[error,setError]=useState(''),[submitting,setSubmitting]=useState(false),[blocked,setBlocked]=useState(false),[ended,setEnded]=useState(false),[confirm,setConfirm]=useState(false);
  const refs=useRef({answers:initial.answers||{},usedAI:initial.usedAI,revision:initial.revision,generation:0,saved:0,exported:0,blocked:false,ended:false,mutex:null,alive:true,offset:Date.parse(initial.serverTime)-Date.now()});const s=refs.current;
  const remaining=Math.max(0,Math.ceil((Date.parse(initial.deadlineAt)-(tick+s.offset))/1000));
  useEffect(()=>{s.alive=true;const timer=setInterval(()=>setTick(Date.now()),1000);draftGuard.current=preserveDraft;const before=e=>{if(s.generation>s.saved&&s.generation>s.exported){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',before);return()=>{s.alive=false;draftGuard.current=()=>true;clearInterval(timer);window.removeEventListener('beforeunload',before);};},[]);
  useEffect(()=>{if(!initial.recordSwitch)return;const visibility=()=>{if(document.hidden&&!s.ended&&!s.blocked)portalApi(initial.id,'events',{method:'POST',body:{eventId:crypto.randomUUID()}}).catch(e=>{if(e.code==='PORTAL_CONTEXT_MISMATCH'||e.status===401)pause(e);});};document.addEventListener('visibilitychange',visibility);return()=>document.removeEventListener('visibilitychange',visibility);},[initial.recordSwitch]);
  useEffect(()=>{if(remaining!==0||s.ended)return;s.ended=true;setEnded(true);setStatus('时间已结束，正在确认服务器状态…');portalApi(initial.id).then(result=>{if(result.status==='submitted'){setStatus('时间已结束，截止前成功保存的内容已提交。');}else setError('请刷新确认测评状态，并先下载本地答案副本。');}).catch(setError);},[remaining]);
  function preserveDraft(){if(s.generation>s.saved&&s.generation>s.exported){setError('当前有未保存的本地内容。请先下载本地答案副本，再退出或查看结果。');return false;}return true;}
  function pause(e){s.blocked=true;if(s.alive){setBlocked(true);setStatus('测评会话已变化，自动保存已暂停');setError(e);}}
  async function save(submit=false){
    if(s.mutex){try{await s.mutex;}catch{ /* preserve local draft */ }}
    if(s.blocked||s.ended)throw new Error('测评已结束或存在版本冲突，请先保留答案副本。');
    if(!submit&&s.generation===s.saved)return;
    const generation=s.generation;const snapshot={...s.answers};
    const task=(async()=>{setStatus(submit?'正在提交…':'正在保存…');setError('');
      try{const result=await portalApi(initial.id,submit?'submit':'answers',{method:submit?'POST':'PUT',body:{revision:s.revision,answers:snapshot,usedAI:s.usedAI}});s.revision=result.revision;s.saved=generation;if(!s.alive)return;setStatus('已保存 · '+new Date().toLocaleTimeString('zh-CN',{hour12:false}));if(submit){s.ended=true;onComplete(result);}}
      catch(e){if(!s.alive)throw e;if(e.code==='PORTAL_CONTEXT_MISMATCH'||e.status===401){pause(e);}else if(e.status===409){try{const latest=await portalApi(initial.id);if(latest.status==='submitted'){s.ended=true;setEnded(true);setStatus('测评已结束，服务器已保留成功保存的内容');setError('本地未保存文字仍保留在本页，请下载副本后查看提交结果。');}else{s.blocked=true;setBlocked(true);setStatus('版本冲突，自动保存已暂停');setError(e);}}catch{ s.blocked=true;setBlocked(true);setStatus('无法确认服务器状态，自动保存已暂停');setError(e);}}else{setStatus('尚未保存到服务器');setError(e);}throw e;}
    })();s.mutex=task;try{await task;}finally{if(s.mutex===task)s.mutex=null;if(s.alive)setCycle(c=>c+1);}
  }
  useEffect(()=>{if(s.generation===s.saved||s.blocked||s.ended||submitting)return;const timer=setTimeout(()=>save().catch(()=>{}),error?8000:900);return()=>clearTimeout(timer);},[answers,usedAI,cycle,submitting,ended,blocked]);
  function change(id,value){s.answers={...s.answers,[id]:value};s.generation++;setAnswers(s.answers);setStatus('有未保存的修改');}
  function download(){const lines=[initial.name,'候选人：'+initial.candidateName,'测评编号：'+initial.id,'披露使用 AI：'+(s.usedAI?'是':'否'),'本地答案副本；以服务器已保存内容为准',''];initial.questions.forEach((q,i)=>{lines.push((i+1)+'. '+q.title,s.answers[q.id]||'（未作答）','');});const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='测评答案副本.txt';a.click();s.exported=s.generation;setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <div className="stack"><div className="exam-sticky"><div><h1>{initial.name}</h1><span>{initial.candidateName} · {initial.questions.length} 道题</span></div><div className={'countdown '+(remaining<300?'time-warning':'')} role="timer" aria-label="剩余作答时间"><Clock3 size={19}/>{Math.floor(remaining/60).toString().padStart(2,'0')}:{(remaining%60).toString().padStart(2,'0')}</div></div><div className="save-status" role="status"><Save size={16}/>{status}</div><ErrorBox error={error}/>{ended&&<div className="alert">服务器将以截止前成功保存的内容为准。本页仍保留您的本地文字，可下载副本核对。<Button secondary onClick={async()=>{try{if(preserveDraft())onComplete(await portalApi(initial.id));}catch(e){setError(e);}}}>查看提交结果</Button></div>}{blocked&&<div className="alert alert-error">测评会话或答案版本已变化，当前草稿已保留，自动保存和提交已暂停。请先下载副本，再通过本次专属邀请链接重新进入。</div>}{initial.questions.map((q,index)=><section className="panel pad stack exam-question" key={q.id}><span className="eyebrow">第 {index+1} 题 · {q.type} · {q.competency}</span><h2>{q.title}</h2><Field label={'第 '+(index+1)+' 题答案'} hint={(answers[q.id]||'').length+' / 20000 字'}><textarea rows={12} maxLength={20000} disabled={submitting||ended||blocked} value={answers[q.id]||''} onChange={e=>change(q.id,e.target.value)} placeholder="请结合实际业务说明您的思考与做法…"/></Field></section>)}<section className="panel pad stack"><label className="check-line"><input type="checkbox" disabled={submitting||ended||blocked} checked={usedAI} onChange={e=>{s.usedAI=e.target.checked;s.generation++;setUsedAI(s.usedAI);setStatus('有未保存的修改');}}/>我在本次作答中使用了 AI 工具（请如实披露）</label>{!initial.allowAI&&<small className="muted">本测评规则不允许 AI。实际使用时仍请如实披露，交由企业人工复核。</small>}<div className="inline-actions"><Button secondary onClick={download}><Download size={16}/>下载本地答案副本</Button><Button secondary disabled={submitting||ended||blocked} onClick={()=>save().catch(()=>{})}>立即保存</Button><Button disabled={submitting||ended||blocked} onClick={()=>setConfirm(true)}>提交测评</Button></div>{confirm&&!ended&&<div className="alert stack"><p>提交后无法修改。当前已作答 {initial.questions.filter(q=>(answers[q.id]||'').trim()).length} / {initial.questions.length} 题。确认将最新答案提交给企业？</p><div className="inline-actions"><Button disabled={submitting||blocked} onClick={async()=>{setSubmitting(true);try{await save(true);}catch{ /* error displayed, retain answers */ }finally{setSubmitting(false);}}}>{submitting?'正在提交…':'确认提交'}</Button><Button secondary disabled={submitting} onClick={()=>setConfirm(false)}>继续检查</Button></div></div>}</section></div>;
}
