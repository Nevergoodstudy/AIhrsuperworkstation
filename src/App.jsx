import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { BriefcaseBusiness, Users, LayoutDashboard, ClipboardList, BookOpen, Settings, LogOut, Plus, RefreshCw, Sprout, ArrowRight, ShieldCheck, Download, Search } from 'lucide-react';
import { api, date, roles, examStates, stages } from './api';
import { Button, ErrorBox, Empty, Loading, Badge, Panel, Heading, Modal, Field, Form, Confirm } from './ui';
import CandidatePortal, { CandidateResult } from './CandidatePortal';
import { DecisionForm, FeedbackLinkActions, ReviewPlanForm, ReviewTasks, WorkflowStatus } from './ReviewWorkflow';

const Workspace = createContext(null);
const useWorkspace = () => useContext(Workspace);
const textField=(key,label,maxLength=100,extra={})=>({key,label,required:true,maxLength,...extra});
const choices = array => array.map(item=>({value:item.id,label:item.title || item.name}));
const jobFields=[textField('title','岗位名称'),textField('department','所属部门（与复核人部门名称完全一致）'),textField('location','工作地点'),textField('description','岗位职责',10000,{type:'textarea'}),{key:'requirementsText',label:'筛选要求（一行一项）',type:'textarea',maxLength:15000,hint:'覆盖率仅表示这些要求的证据覆盖，不是录用分数。'},{key:'status',label:'招聘状态',type:'select',options:['招聘中','暂停','已关闭']}];
const questionFields=[textField('title','题目正文',10000,{type:'textarea'}),textField('competency','考察能力'),{key:'type',label:'题目类型',type:'select',options:['情景题','实操题','简答题']},{key:'level',label:'难度',type:'select',options:['基础','进阶','专家']},{key:'minutes',label:'建议作答分钟数',type:'number',min:1,max:180,required:true},textField('rubric','人工评分要点',5000,{type:'textarea',hint:'请写明 1–5 分的具体标准；该内容不会发送给候选人。'}),{key:'active',label:'可用于新测评',type:'checkbox'}];
export default function App() {
  const [{ hash, visit }, setRoute] = useState({ hash: location.hash, visit: 0 });
  useEffect(() => {
    const change = () => setRoute(previous => ({ hash: location.hash, visit: previous.visit + 1 }));
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  if (/^#\/result(?:\/|$)/.test(hash)) return <CandidateResult key={visit} token={hash.slice('#/result/'.length)}/>;
  if (/^#\/(invite\/|candidate)/.test(hash)) return <CandidatePortal key={hash}/>;
  return <StaffApp/>;
}
function StaffApp() {
  const [auth,setAuth]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [data,setData]=useState(null),[view,setView]=useState('dashboard'),[modal,setModal]=useState(null),[notice,setNotice]=useState('');
  const load=useCallback(async()=>{ const result=await api('/api/workspace');setData(result); },[]);
  const initialize=useCallback(async()=>{setLoading(true);setError('');try { const result=await api('/api/auth/me');setAuth(result);if (!result.user.mustChange) await load(); } catch(e) {if(e.status!==401)setError(e);setAuth(null);}finally{setLoading(false);}},[load]);
  useEffect(()=>{ initialize();const expire=()=>{setAuth(null);setData(null);setModal(null);setNotice('登录已过期，请重新登录。');};window.addEventListener('staff-session-expired',expire);return()=>window.removeEventListener('staff-session-expired',expire);},[initialize]);
  useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),7000);return()=>clearTimeout(t);},[notice]);
  function open(title,content){setModal({title,content});}
  const close=()=>setModal(null);
  async function mutate(path,method,body,message='已保存'){await api(path,{method,body});await load();setNotice(message);}
  async function logout(){try{await api('/api/auth/logout',{method:'POST'});setAuth(null);setData(null);setModal(null);}catch(e){setError(e);}}
  function passwordForm(){return <Form initial={{current:'',password:'',confirm:''}} fields={[textField('current','当前密码',128,{type:'password',autoComplete:'current-password'}),textField('password','新密码（至少 12 位）',128,{type:'password',minLength:12,autoComplete:'new-password'}),textField('confirm','再次输入新密码',128,{type:'password',minLength:12,autoComplete:'new-password'})]} submit="修改并重新登录" onSubmit={async value=>{if(value.password!==value.confirm)throw new Error('两次新密码不一致');await api('/api/auth/password',{method:'POST',body:value});setAuth(null);setData(null);close();setNotice('密码已更新，请用新密码登录。');}}/>;}
  if(loading) return <div className="auth-shell"><Loading/></div>;
  if(!auth) return <div className="auth-shell"><section className="auth-card"><div className="brand-mark"><Sprout/></div><h1>TalentDesk 招聘工作台</h1><p>登录企业账号，进入真实招聘工作区。</p><ErrorBox error={error}/>{notice&&<p role="status">{notice}</p>}<Form initial={{email:'',password:''}} fields={[textField('email','工作邮箱',254,{type:'email',autoComplete:'username'}),textField('password','密码',128,{type:'password',autoComplete:'current-password'})]} submit="登录工作区" onSubmit={async values=>{const result=await api('/api/auth/login',{method:'POST',body:values});setAuth(result);if(!result.user.mustChange){try{await load();}catch(e){setError(e);}}}}/><p className="muted">账号由企业管理员创建。首次部署请在服务器运行 npm run admin:create。忘记密码请联系管理员。</p></section></div>;
  if(auth.user.mustChange) return <div className="auth-shell"><section className="auth-card"><h1>设置您的新密码</h1><p>首次登录或管理员重置后，需要更换临时密码。</p>{passwordForm()}<Button secondary onClick={logout}>退出登录</Button></section></div>;
  if(!data) return <div className="auth-shell"><ErrorBox error={error}/><Button onClick={initialize}>重试加载</Button></div>;
  const hr=data.user.role!=='department';
  const nav=[['dashboard','工作概览',LayoutDashboard],['jobs','招聘岗位',BriefcaseBusiness],['candidates','候选人',Users],['questions','题库',BookOpen],['assessments','测评方案',ClipboardList],['exams','测评与复核',ShieldCheck],['settings','设置与账号',Settings]];
  const ctx={data,hr,open,close,mutate,refresh:load,notify:setNotice,setView};
  return <Workspace.Provider value={ctx}><div className="app-shell"><aside className="sidebar"><div className="brand-lockup"><span className="brand-mark"><Sprout/></span><div><strong>TalentDesk</strong><span>招聘与能力测评</span></div></div><div className="workspace-switcher"><span className="workspace-icon">企</span><span><strong>{data.company}</strong><small>{roles[data.user.role]}{data.user.department&&' · '+data.user.department}</small></span></div><p className="nav-heading">工作区</p><nav className="primary-nav">{nav.map(([key,label,Icon])=><button key={key} className={'nav-item '+(view===key?'nav-active':'')} onClick={()=>setView(key)}><Icon size={19}/><span>{label}</span>{key==='candidates'&&<small>{data.candidates.length}</small>}</button>)}</nav><div className="sidebar-bottom"><div className="sidebar-note"><strong>业务数据实时持久化</strong><p>测评结果由人工复核。证据覆盖率用于辅助整理，不替代招聘判断。</p></div><div className="profile-row"><span className="profile-avatar">{data.user.name.slice(0,1)}</span><span><strong>{data.user.name}</strong><small>{roles[data.user.role]}</small></span><button className="sidebar-logout" aria-label="退出登录" onClick={logout}><LogOut size={19}/></button></div></div></aside><main className="main-area"><header className="topbar"><div className="breadcrumb">{data.company}<ArrowRight size={14}/><strong>{nav.find(n=>n[0]===view)?.[1]}</strong></div><div className="top-actions"><button className="icon-button mobile-logout" aria-label="退出工作区" onClick={logout}><LogOut size={18}/></button><Button secondary onClick={()=>open('修改密码',passwordForm())}>修改密码</Button><button className="icon-button" aria-label="刷新工作区" onClick={async()=>{try{await load();setNotice('数据已刷新');}catch(e){setError(e);}}}><RefreshCw size={18}/></button></div></header><div className="page-content"><ErrorBox error={error}/>{view==='dashboard'?<Dashboard/>:view==='jobs'?<Jobs/>:view==='candidates'?<Candidates/>:view==='questions'?<Questions/>:view==='assessments'?<Assessments/>:view==='exams'?<Exams/>:<SettingsPage/>}</div></main></div>{notice&&<div role="status" className="toast">{notice}</div>}{modal&&<Modal key={modal.title} title={modal.title} close={close}>{modal.content}</Modal>}</Workspace.Provider>;
}
function Dashboard(){
  const {data,setView,hr}=useWorkspace();
  const metrics=[['招聘中岗位',data.jobs.filter(j=>j.status==='招聘中').length],['候选人',data.candidates.length],['进行中测评',data.exams.filter(e=>['invited','in_progress'].includes(e.status)).length],['待人工复核',data.exams.filter(e=>e.status==='submitted'&&!e.feedback).length]];
  return <><Heading title="招聘工作概览" description="从岗位需求到人工决策，跟进每一次真实招聘。"><Button secondary onClick={()=>setView('candidates')}>查看候选人<ArrowRight size={16}/></Button></Heading><div className="metrics-row">{metrics.map(([label,count])=><div className="metric" key={label}><span className="metric-icon metric-green"><Users size={18}/></span><div className="metric-copy"><span>{label}</span><strong>{count}</strong><small>当前工作区实际记录</small></div></div>)}</div><div className="two-columns section-gap"><Panel title="招聘进程"><div className="stage-grid">{stages.map(stage=><div key={stage}><span>{stage}</span><strong>{data.candidates.filter(c=>c.stage===stage).length}</strong></div>)}</div></Panel><Panel title="服务连接"><div className="stack pad"><p><Badge warn={!data.readiness.ai}>{data.readiness.ai?'AI 已配置，需实际请求验证':'AI 未配置'}</Badge></p><p>关键词证据分析可直接使用；外部 AI 分析需要单独授权。</p><p><Badge warn={!data.readiness.email}>{data.readiness.email?'邮件已配置，发送结果逐次显示':'邮件未配置，可手动分享邀请'}</Badge></p><p><Badge warn={!data.readiness.secure}>{data.readiness.secure?'HTTPS 地址已配置':'本地 HTTP，仅供本机验证'}</Badge></p></div></Panel></div>{!data.jobs.length?<Panel title="开始第一轮招聘"><Empty action={<Button onClick={()=>setView('jobs')}>{hr?'创建首个岗位':'查看岗位'}</Button>}>当前没有岗位或示例数据。按顺序建立岗位、题目、测评方案，再导入真实候选人。</Empty></Panel>:<Panel title="最近的候选人"><CandidateTable candidates={data.candidates.slice(0,6)}/></Panel>}</>;
}
function Jobs(){
  const {data,hr,open,close,mutate}=useWorkspace();
  function edit(job){open(job?'编辑岗位':'创建岗位',<Form initial={job?{...job,requirementsText:job.requirements.join('\n')}:{title:'',department:'',location:'',description:'',requirementsText:'',status:'招聘中'}} fields={jobFields} onSubmit={async value=>{await mutate('/api/jobs'+(job?'/'+job.id:''),job?'PUT':'POST',{...value,requirements:value.requirementsText.split('\n').map(s=>s.trim()).filter(Boolean)});close();}}/>);}
  return <><Heading title="招聘岗位" description="明确岗位要求，所有候选人和测评均归属具体岗位。">{hr&&<Button onClick={()=>edit()}><Plus size={17}/>创建岗位</Button>}</Heading>{!data.jobs.length?<Empty>暂无岗位。</Empty>:<div className="card-grid">{data.jobs.map(job=><Panel key={job.id} title={job.title} actions={<Badge>{job.status}</Badge>}><div className="stack pad"><p className="muted">{job.department} · {job.location}</p><p className="pre-wrap">{job.description}</p><div className="tags">{job.requirements.map(r=><Badge key={r}>{r}</Badge>)}</div><p>{data.candidates.filter(c=>c.jobId===job.id).length} 位候选人</p>{hr&&<Button secondary onClick={()=>edit(job)}>编辑岗位</Button>}</div></Panel>)}</div>}</>;
}
function CandidateTable({candidates}){
  const {data,open}=useWorkspace();
  if(!candidates.length)return <Empty>暂无符合条件的候选人。</Empty>;
  return <div className="table-scroll"><table className="business-table"><thead><tr><th>候选人</th><th>岗位 / 部门</th><th>当前阶段</th><th>证据覆盖率</th><th>操作</th></tr></thead><tbody>{candidates.map(c=><tr key={c.id}><td><strong>{c.name}</strong>{c.email&&<small>{c.email}</small>}</td><td>{data.jobs.find(j=>j.id===c.jobId)?.title}<small>{data.jobs.find(j=>j.id===c.jobId)?.department}</small></td><td><Badge>{c.stage}</Badge></td><td>{c.analysis.stale?'分析已过期':c.analysis.score==null?'未设筛选要求':c.analysis.score+'%'}<small>{c.analysis.method==='ai'?'AI 原文证据覆盖':'关键词覆盖'}</small></td><td><button className="text-button" onClick={()=>open('候选人资料',<CandidateDetail candidateId={c.id}/>)}>查看资料</button></td></tr>)}</tbody></table></div>;
}
function Candidates(){
  const {data,hr,open}=useWorkspace();const [query,setQuery]=useState(''),[stage,setStage]=useState(''),[job,setJob]=useState('');
  const visible=data.candidates.filter(c=>(!stage||c.stage===stage)&&(!job||c.jobId===job)&&(!query||(c.name+' '+(c.email||'')+' '+c.skills.join(' ')).toLowerCase().includes(query.toLowerCase())));
  return <><Heading title="候选人管理" description="资料、简历原件、证据和招聘进程集中管理。">{hr&&<><a className="button button-secondary" href="/api/export/candidates" download><Download size={16}/>导出 CSV</a><Button disabled={!data.jobs.some(j=>j.status==='招聘中')} onClick={()=>open('新增候选人',<CandidateCreate/>)}><Plus size={17}/>新增 / 导入简历</Button></>}</Heading><Panel><div className="filter-bar"><label className="search-control"><Search size={17}/><input aria-label="搜索候选人" placeholder="搜索姓名、邮箱或技能" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="筛选岗位" value={job} onChange={e=>setJob(e.target.value)}><option value="">全部岗位</option>{data.jobs.map(j=><option key={j.id} value={j.id}>{j.title}</option>)}</select><select aria-label="筛选阶段" value={stage} onChange={e=>setStage(e.target.value)}><option value="">全部阶段</option>{stages.map(s=><option key={s}>{s}</option>)}</select><span className="muted">{visible.length} 位</span></div><CandidateTable candidates={visible}/></Panel></>;
}
function CandidateCreate(){
  const {data,mutate,close}=useWorkspace();const [file,setFile]=useState(null),[fileError,setFileError]=useState('');
  return <Form initial={{jobId:data.jobs.find(j=>j.status==='招聘中')?.id||'',name:'',email:'',phone:'',resumeText:'',consent:false}} fields={[{key:'jobId',label:'应聘岗位',type:'select',options:choices(data.jobs.filter(j=>j.status==='招聘中')),required:true},textField('name','候选人姓名'),{key:'email',label:'邮箱（发送邮件邀请时必填）',type:'email',maxLength:254},{key:'phone',label:'电话',maxLength:50}]} submit="保存候选人" onSubmit={async values=>{if(!values.consent)throw new Error('请确认候选人已授权处理招聘资料');if(file){const form=new FormData();['jobId','name','email','phone','consent'].forEach(key=>form.append(key,String(values[key])));form.append('resume',file);await mutate('/api/candidates/import','POST',form);}else{await mutate('/api/candidates','POST',values);}close();}}>{(values,change)=><><ErrorBox error={fileError}/><Field label="上传简历原件（PDF / DOCX / TXT，最大 10 MB）" hint="文件存放在服务器私有目录；扫描 PDF 暂不支持 OCR。"><input type="file" accept=".pdf,.docx,.txt" onChange={e=>{const f=e.target.files?.[0];if(f&&f.size>10*1024*1024){e.target.value='';setFile(null);setFileError('简历文件超过 10 MB，请压缩或粘贴正文。');return;}setFileError('');setFile(f||null);}}/></Field>{!file&&<Field label="或粘贴简历正文"><textarea required rows={9} maxLength={500000} value={values.resumeText} onChange={e=>change('resumeText',e.target.value)}/></Field>}<label className="check-line"><input type="checkbox" required checked={values.consent} onChange={e=>change('consent',e.target.checked)}/>已获得候选人授权，可为本次招聘保存及处理其资料。</label></>}</Form>;
}
function CandidateDetail({candidateId}){
  const ctx=useWorkspace(),{data,hr,mutate,open,close}=ctx;const [c,setC]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[aiConsent,setAIConsent]=useState(false);
  const load=()=>api('/api/candidates/'+candidateId).then(setC);useEffect(()=>{load().catch(setError);},[candidateId]);
  async function analyze(method){setBusy(true);setError('');try{await mutate('/api/candidates/'+c.id+'/analyze','POST',{method,consent:aiConsent},'分析结果已保存');await load();}catch(e){setError(e);if(e.status===409)await load().catch(()=>{});}finally{setBusy(false);}}
  if(!c)return <><ErrorBox error={error}/>{!error&&<Loading/>}</>;
  const currentJob=data.jobs.find(j=>j.id===c.jobId);
  const analysis=currentJob&&c.analysis.source&&currentJob.version>c.analysis.source.jobVersion?{...c.analysis,stale:true,staleReason:'岗位已更新，请重新分析'}:c.analysis;
  const exams=data.exams.filter(e=>e.candidateId===c.id);
  return <div className="stack"><ErrorBox error={error}/><div className="detail-intro"><span className="avatar avatar-large avatar-mint">{c.name.slice(0,1)}</span><div><h3>{c.name}</h3><p>{data.jobs.find(j=>j.id===c.jobId)?.title} · {c.stage}</p></div></div>{hr&&<Form key={c.version} initial={{name:c.name,email:c.email,phone:c.phone,stage:c.stage,version:c.version}} fields={[textField('name','姓名'),{key:'email',label:'邮箱',type:'email',maxLength:254},{key:'phone',label:'电话',maxLength:50},{key:'stage',label:'招聘阶段',type:'select',options:stages}]} onSubmit={async value=>{await mutate('/api/candidates/'+c.id,'PUT',value);await load();}}/>}<Panel title="简历证据分析"><div className="stack pad"><strong>{analysis.label || '关键词覆盖'}：{analysis.stale?'分析已过期':analysis.score==null?'未设置要求':analysis.score+'%'}</strong><p className="muted">覆盖率只反映已找到证据的岗位要求比例。未找到不代表没有能力；所有结论都需要人工核实。</p>{analysis.stale&&<p className="alert alert-error">{analysis.staleReason}。以下仅为历史分析证据，不能作为当前岗位的覆盖结果。</p>}{analysis.summary&&<div>{analysis.method==='ai'&&<strong>AI 生成概述（需人工核验）</strong>}<p>{analysis.summary}</p></div>}{analysis.model&&<small className="muted">AI 模型：{analysis.model} · {date(analysis.analyzedAt)}</small>}{(analysis.evidence||[]).map(e=><div key={e.requirement} className="evidence"><strong>{e.matched?'找到证据':'未找到证据'} · {e.requirement}</strong>{e.quote&&<blockquote>{e.quote}</blockquote>}</div>)}{hr&&<><div className="inline-actions"><Button secondary disabled={busy} onClick={()=>analyze('keyword')}>重新分析关键词</Button></div><label className="check-line"><input type="checkbox" checked={aiConsent} onChange={e=>setAIConsent(e.target.checked)}/>候选人已明确授权将简历正文发送至企业配置的外部 AI 服务。</label><Button disabled={busy||!aiConsent||!data.readiness.ai} onClick={()=>analyze('ai')}>{busy?'正在分析…':data.readiness.ai?'使用 AI 整理原文证据':'AI 服务未配置'}</Button></>}</div></Panel>{hr&&<details><summary>查看简历正文</summary><pre className="resume-text">{c.resumeText}</pre>{c.hasFile&&<a className="button button-secondary" href={'/api/candidates/'+c.id+'/resume'} download>下载简历原件：{c.fileName}</a>}</details>}{!hr&&<p className="muted">部门账号仅查看本部门候选人的筛选证据及测评答卷，联系方式与简历原件不开放。</p>}<Panel title="测评记录" actions={hr&&<Button secondary onClick={()=>open('发起测评邀请',<InviteForm candidate={c}/>)}>发起测评</Button>}><ExamTable exams={exams}/></Panel>{hr&&<Button danger onClick={()=>open('永久删除候选人',<Confirm danger label="永久删除" message={'确认删除 '+c.name+' 的资料、简历原件、测评及复核记录？此操作无法撤销。请确认符合企业资料保留制度。'} action={async()=>{await mutate('/api/candidates/'+c.id,'DELETE',undefined,'候选人及关联数据已删除');close();}}/>)}>删除候选人及关联记录</Button>}</div>;
}
function Questions(){
  const {data,hr,open,close,mutate}=useWorkspace();
  function edit(q){open(q?'编辑题目':'创建题目',<Form initial={q||{title:'',competency:'',type:'情景题',level:'进阶',minutes:15,rubric:'',active:true}} fields={questionFields} onSubmit={async value=>{await mutate('/api/questions'+(q?'/'+q.id:''),q?'PUT':'POST',value);close();}}/>);}
  return <><Heading title="能力题库" description="题目和评分要点由企业维护；已发出的测评保留创建时的题目快照。">{hr&&<Button onClick={()=>edit()}><Plus size={17}/>创建题目</Button>}</Heading>{!data.questions.length?<Empty>暂无题目，请先建立真实业务题目及评分标准。</Empty>:<div className="stack">{data.questions.map(q=><Panel key={q.id} title={q.competency} actions={<Badge warn={!q.active}>{q.active?'可用':'已停用'}</Badge>}><div className="stack pad"><p className="pre-wrap">{q.title}</p><p className="muted">{q.type} · {q.level} · 建议 {q.minutes} 分钟</p><details><summary>人工评分要点</summary><p className="pre-wrap">{q.rubric}</p></details>{hr&&<Button secondary onClick={()=>edit(q)}>编辑题目</Button>}</div></Panel>)}</div>}</>;
}
function Assessments(){
  const {data,hr,open}=useWorkspace();return <><Heading title="测评方案" description="选择真实题目并明确规则；方案修改只影响后续邀请。">{hr&&<Button disabled={!data.jobs.length||!data.questions.some(q=>q.active)} onClick={()=>open('创建测评方案',<AssessmentForm/>)}><Plus size={17}/>创建方案</Button>}</Heading>{!data.assessments.length?<Empty>暂无测评方案。请先建立岗位和题目。</Empty>:<div className="card-grid">{data.assessments.map(a=><Panel key={a.id} title={a.name}><div className="stack pad"><p>{data.jobs.find(j=>j.id===a.jobId)?.title}</p><p>{a.questionIds.length} 道题 · {a.duration} 分钟</p><div className="tags"><Badge>{a.allowAI?'允许 AI，须披露':'不允许 AI'}</Badge><Badge>{a.randomize?'随机题序':'固定题序'}</Badge><Badge>{a.recordSwitch?'记录切屏次数':'不记录切屏'}</Badge></div>{hr&&<Button secondary onClick={()=>open('编辑测评方案',<AssessmentForm assessment={a}/>)}>编辑方案</Button>}</div></Panel>)}</div>}</>;
}
function AssessmentForm({assessment}){
  const {data,mutate,close}=useWorkspace();return <Form initial={assessment||{jobId:data.jobs[0]?.id||'',name:'',duration:60,questionIds:[],allowAI:false,randomize:false,recordSwitch:false}} fields={[textField('name','方案名称'),{key:'jobId',label:'所属岗位',type:'select',required:true,options:choices(data.jobs)},{key:'duration',label:'总时长（分钟）',type:'number',min:1,max:240,required:true},{key:'allowAI',label:'允许使用 AI（仍需候选人披露）',type:'checkbox'},{key:'randomize',label:'随机排列题目',type:'checkbox'},{key:'recordSwitch',label:'记录页面隐藏次数（会向候选人告知，仅作复核参考）',type:'checkbox'}]} onSubmit={async value=>{if(!value.questionIds.length)throw new Error('请至少选择一道题');await mutate('/api/assessments'+(assessment?'/'+assessment.id:''),assessment?'PUT':'POST',value);close();}}>{(values,change)=><div className="question-picker"><strong>选择题目 · 已选 {values.questionIds.length} 道</strong>{data.questions.filter(q=>q.active||values.questionIds.includes(q.id)).map(q=><label className="check-line" key={q.id}><input type="checkbox" checked={values.questionIds.includes(q.id)} onChange={e=>change('questionIds',e.target.checked?[...values.questionIds,q.id]:values.questionIds.filter(id=>id!==q.id))}/><span>{q.title}<small>{q.competency} · {q.minutes} 分钟{!q.active&&' · 已停用，请移除'}</small></span></label>)}</div>}</Form>;
}
function InviteForm({candidate}){
  const {data,refresh,notify}=useWorkspace();const [invitation,setInvitation]=useState(null),[error,setError]=useState('');
  const options=data.assessments.filter(a=>a.jobId===candidate.jobId);
  if(invitation)return <div className="stack"><div className="alert">邀请已创建。链接只在本次创建时展示，请立即保存并通过可信渠道发送给候选人。</div><Field label="候选人专属邀请链接"><input readOnly value={invitation.inviteUrl} onFocus={e=>e.target.select()}/></Field><Button onClick={async()=>{try{await navigator.clipboard.writeText(invitation.inviteUrl);notify('邀请链接已复制');}catch{setError('自动复制不可用，请选中上方链接后复制。');}}}>复制邀请链接</Button><p>{invitation.mailStatus==='accepted'?'邮件已被 SMTP 服务接受，最终送达请以邮箱回执为准。':invitation.mailStatus==='failed'?'邮件发送失败：'+invitation.mailError:'尚未发送邮件，请手动分享链接。'}</p><ErrorBox error={error}/><Button secondary disabled={!data.readiness.email} onClick={async()=>{try{const r=await api('/api/exams/'+invitation.id+'/send',{method:'POST',body:{inviteToken:invitation.inviteUrl.split('/').pop()}});setInvitation({...invitation,mailStatus:r.mailStatus,mailError:''});await refresh();}catch(e){setError(e);}}}>通过邮件发送 / 重试</Button><p className="muted">链接丢失时可撤销旧邀请并创建新邀请。不要公开分享专属链接。</p></div>;
  if(!options.length)return <Empty>该岗位尚无测评方案，请先创建对应方案。</Empty>;
  return <Form initial={{assessmentId:options[0].id,validDays:7,sendEmail:false}} fields={[{key:'assessmentId',label:'测评方案',type:'select',options:choices(options),required:true},{key:'validDays',label:'邀请有效天数',type:'number',min:1,max:14,required:true},{key:'sendEmail',label:'同时发送邮件（需已配置 SMTP 且候选人有邮箱）',type:'checkbox'}]} submit="创建专属邀请" onSubmit={async value=>{const result=await api('/api/exams',{method:'POST',body:{...value,candidateId:candidate.id}});setInvitation(result);await refresh();}}><p>候选人：{candidate.name} · 创建邀请时固定题目与评分要点；每位候选人只能有一份待开始或进行中的测评。面试中、录用、不合适等人工阶段会保留；人工改阶段后，有效测评仍可完成，但不会自动覆盖该阶段。如需结束作答，请同时撤销测评。</p></Form>;
}
function ExamTable({exams}){
  const {data,open}=useWorkspace();if(!exams.length)return <Empty>暂无测评记录。</Empty>;return <div className="table-scroll"><table className="business-table"><thead><tr><th>候选人 / 测评</th><th>状态</th><th>邀请有效期 / 提交时间</th><th>操作</th></tr></thead><tbody>{exams.map(e=><tr key={e.id}><td><strong>{data.candidates.find(c=>c.id===e.candidateId)?.name}</strong><small>{e.name}</small></td><td><Badge warn={['expired','revoked'].includes(e.status)}>{examStates[e.status]}</Badge>{e.feedback&&<small>反馈已发布</small>}</td><td>{date(e.submittedAt||e.expiresAt)}</td><td><button className="text-button" onClick={()=>open('测评答卷与人工复核',<ExamDetail examId={e.id}/>)}>查看测评</button></td></tr>)}</tbody></table></div>;
}
function Exams() {
  const { data, open } = useWorkspace();
  const [status, setStatus] = useState('');
  return <>
    <Heading title="测评与人工复核" description="按创建时的题目与评分要点复核。"/>
    <ReviewTasks refreshKey={data} openExam={examId => open('测评答卷与人工复核', <ExamDetail examId={examId}/>)}/>
    <Panel>
      <div className="filter-bar">
        <select aria-label="测评状态" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          {Object.entries(examStates).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
      <ExamTable exams={data.exams.filter(exam => !status || exam.status === status)}/>
    </Panel>
  </>;
}

function ExamDetail({ examId }) {
  const { data, hr, mutate, open, close, refresh } = useWorkspace();
  const [exam, setExam] = useState(null), [error, setError] = useState('');
  const route = '/api/exams/' + examId;
  const load = useCallback(async () => setExam(await api(route)), [route]);
  useEffect(() => { load().catch(setError); }, [load]);
  if (!exam) return <><ErrorBox error={error}/>{!error && <Loading/>}</>;

  const workflow = exam.workflow;
  const mine = workflow ? workflow.mine : exam.reviews.find(review => review.userId === data.user.id);
  const candidate = data.candidates.find(person => person.id === exam.candidateId);
  const submitted = exam.status === 'submitted';
  const canPublish = hr && (workflow ? workflow.canPublish : exam.reviews.length > 0);
  const canEditPlan = hr && !workflow && !exam.feedback && !exam.reviews.length
    && ['invited', 'in_progress', 'submitted'].includes(exam.status);
  const backToExam = () => open('测评答卷与人工复核', <ExamDetail examId={examId}/>);

  function editPlan() {
    open('安排独立评审', <ReviewPlanForm exam={exam} ownerId={data.user.id} save={async values => {
      await mutate(route + '/review-plan', 'PUT', values, '评审安排已保存');
      backToExam();
    }}/>);
  }

  function reopen(task) {
    open('重新打开复核', <Form initial={{ reason: '' }}
      fields={[textField('reason', '重新打开原因', 500)]}
      submit="重新打开" onSubmit={async ({ reason }) => {
        await mutate(route + '/review-reopen', 'POST', { taskId: task.id, version: task.version, reason }, '复核已重新打开');
        backToExam();
      }}/>);
  }

  async function publish(values) {
    await mutate(route + '/feedback', 'POST', values, '反馈已发布');
    await load();
  }

  function showAnswers(values, change) {
    return exam.questions.map((question, index) => <section className="answer-review" key={question.id}>
      <h3>{index + 1}. {question.title}</h3>
      <p className="muted">{question.competency} · {question.type}</p>
      <div className="answer-text">{exam.answers[question.id] || '（未作答）'}</div>
      <details><summary>评分要点</summary><p className="pre-wrap">{question.rubric}</p></details>
      {change && <Field label="本题评分（1 最低，5 最高）">
        <select required={!workflow} value={values.ratings[question.id] || ''} onChange={event => change('ratings', {
          ...values.ratings, [question.id]: Number(event.target.value)
        })}>
          <option value="">请选择分数</option>
          {[1, 2, 3, 4, 5].map(score => <option key={score} value={score}>{score} 分</option>)}
        </select>
      </Field>}
    </section>);
  }

  return <div className="stack report-print">
    <ErrorBox error={error}/>
    <h3>{candidate?.name} · {exam.name}</h3>
    <div className="tags">
      <Badge>{examStates[exam.status]}</Badge>
      <Badge>{exam.allowAI ? '允许 AI' : '不允许 AI'}</Badge>
      <Badge warn={exam.usedAI && !exam.allowAI}>{exam.usedAI ? '候选人披露使用 AI' : '未披露使用 AI'}</Badge>
    </div>
    <p className="muted">开始 {date(exam.startedAt)}<br/>截止 {date(exam.deadlineAt)}<br/>提交 {date(exam.submittedAt)}<br/>
      {exam.recordSwitch ? '页面隐藏 ' + exam.switchCount + ' 次，仅供人工参考' : '未开启切屏记录'}
    </p>
    {canEditPlan && <Button secondary onClick={editPlan}>安排独立评审</Button>}
    <WorkflowStatus exam={exam} hr={hr} edit={editPlan} reopen={reopen}/>
    {submitted && <>
      {exam.canReview ? <Form key={(mine?.id ?? 'new') + ':' + (mine?.version ?? 0)} initial={{
        taskId: workflow ? mine.id : undefined, version: mine?.version ?? 0,
        ratings: mine?.ratings ?? {}, recommendation: mine?.recommendation ?? '建议补充考察',
        note: mine?.note ?? '', intent: workflow ? 'draft' : 'submit'
      }} submit={workflow ? '保存复核' : '保存我的人工复核'} onSubmit={async values => {
        const ratings = Object.fromEntries(Object.entries(values.ratings).filter(([, score]) => score));
        await mutate(route + '/review', 'PUT', { ...values, ratings }, values.intent === 'submit' ? '人工复核已提交' : '草稿已保存');
        await load();
      }}>{(values, change) => <>
        {showAnswers(values, change)}
        <Field label="推进建议（仅内部可见）">
          <select value={values.recommendation} onChange={event => change('recommendation', event.target.value)}>
            {['建议面试', '建议补充考察', '不建议推进'].map(item => <option key={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="人工复核说明（仅内部可见）">
          <textarea required={!workflow || values.intent === 'submit'} rows={4} maxLength={5000} value={values.note}
            onChange={event => change('note', event.target.value)}/>
        </Field>
        {workflow && <Field label="复核保存方式">
          <select value={values.intent} onChange={event => change('intent', event.target.value)}>
            <option value="draft">保存草稿</option><option value="submit">独立提交</option>
          </select>
        </Field>}
      </>}</Form> : showAnswers()}
      <Panel title={'人工复核记录（' + exam.reviews.length + ' 份）'}>
        <div className="stack pad">{exam.reviews.map(review => <div className="evidence" key={review.id}>
          <strong>{review.reviewer} · {review.recommendation}</strong>
          <p className="muted">{exam.questions.map((question, index) => '第 ' + (index + 1) + ' 题：' + (review.ratings[question.id] ?? '未评分') + ' / 5').join(' · ')}</p>
          <p className="pre-wrap">{review.note}</p>
          <small>{date(review.updatedAt)} · 平均 {(Object.values(review.ratings).reduce((a, b) => a + b, 0) / Object.values(review.ratings).length).toFixed(1)} / 5</small>
        </div>)}</div>
      </Panel>
      {exam.feedback && <Panel title="已发布给候选人的反馈"><div className="stack pad">
        <p>{exam.feedback.message}</p><p>人工评分 {exam.feedback.score} / 100 · {exam.feedback.basis}</p>
        {hr && <FeedbackLinkActions issue={() => api(route + '/feedback-link', { method: 'POST' })}
          revoke={() => api(route + '/feedback-link', { method: 'DELETE' })}/>}
        {hr && <Button secondary onClick={async () => {
          try { await mutate(route + '/feedback', 'DELETE', undefined, '反馈已撤回'); await load(); }
          catch (error) { setError(error); }
        }}>撤回反馈</Button>}
      </div></Panel>}
      {!exam.feedback && canPublish && (workflow ? <DecisionForm exam={exam} publish={publish}/> :
        <Form initial={{ message: '' }} fields={[textField('message', '向候选人发布的反馈', 5000, { type: 'textarea' })]}
          submit="发布反馈给候选人" onSubmit={publish}/>)}
      <Button secondary onClick={() => window.print()}>打印答卷 / 保存 PDF</Button>
    </>}
    {!submitted && <div className="alert">{exam.status === 'in_progress' ? '候选人正在作答，提交后可查看答卷并复核。' : '测评尚未提交，暂无可复核答卷。'}</div>}
    {hr && ['invited', 'in_progress'].includes(exam.status) && <Button danger onClick={() => open('撤销测评',
      <Confirm danger message="撤销后候选人的邀请和会话立即失效，无法继续提交。确认撤销？"
        action={async () => { await mutate(route + '/revoke', 'POST', undefined, '测评已撤销'); close(); await refresh(); }}/>
    )}>撤销测评邀请</Button>}
  </div>;
}
function SettingsPage(){
  const {data,mutate,open,close}=useWorkspace();const [admin,setAdmin]=useState(null),[error,setError]=useState('');const load=()=>api('/api/admin').then(setAdmin);useEffect(()=>{if(data.user.role==='admin')load().catch(setError);},[data.user.role]);
  function createUser(){open('创建企业账号',<Form initial={{name:'',email:'',password:'',role:'hr',department:''}} fields={[textField('name','姓名'),textField('email','工作邮箱',254,{type:'email'}),textField('password','临时密码（至少 12 位，首次登录必须更换）',128,{type:'password',minLength:12,autoComplete:'new-password'}),{key:'role',label:'账号角色',type:'select',options:Object.entries(roles).map(([value,label])=>({value,label}))},{key:'department',label:'所属部门（部门复核人必填，须与岗位部门一致）',maxLength:100}]} onSubmit={async values=>{await mutate('/api/admin/users','POST',values,'账号已创建，请通过安全渠道告知临时密码');await load();close();}}/>);}
  return <><Heading title="设置与账号" description="连接能力和安全状态如实显示；敏感凭证只在服务器环境中配置。"/><Panel title="当前工作区"><div className="stack pad"><p>企业：{data.company}</p><p>当前身份：{data.user.name} · {roles[data.user.role]}</p><p>AI：{data.readiness.ai?'已配置，连通性以实际请求为准':'未配置，可使用关键词分析'}</p><p>邮件：{data.readiness.email?'已配置，送达需邮箱回执确认':'未配置，可复制邀请链接发送'}</p><p>传输：{data.readiness.secure?'配置为 HTTPS':'本地 HTTP；正式使用前须配置 HTTPS'}</p><p className="muted">本版本面向单企业、单实例部署。管理员应按资料保留制度删除过期候选人资料，并定期完成备份和恢复演练。</p></div></Panel><ErrorBox error={error}/>{data.user.role==='admin'&&<><Panel title="企业账号" actions={<Button onClick={createUser}><Plus size={16}/>创建账号</Button>}>{!admin?<Loading/>:<div className="table-scroll"><table className="business-table"><thead><tr><th>姓名 / 邮箱</th><th>角色 / 部门</th><th>状态</th><th>操作</th></tr></thead><tbody>{admin.users.map(u=><tr key={u.id}><td>{u.name}<small>{u.email}</small></td><td>{roles[u.role]}<small>{u.department||'全部部门'}</small></td><td><Badge warn={!u.active}>{u.active?'启用':'停用'}</Badge>{u.mustChange&&<small>需修改密码</small>}</td><td><div className="inline-actions"><button disabled={u.id===data.user.id} className="text-button" onClick={()=>open(u.active?'停用账号':'启用账号',<Confirm message={u.active?'停用后将立即注销该账号的所有登录。':'确认重新启用该账号？'} action={async()=>{await mutate('/api/admin/users/'+u.id,'PATCH',{active:!u.active});await load();close();}}/>)}>{u.active?'停用':'启用'}</button><button className="text-button" onClick={()=>open('重置账号密码',<Form initial={{password:''}} fields={[textField('password','新的临时密码',128,{type:'password',minLength:12,autoComplete:'new-password'})]} onSubmit={async values=>{await mutate('/api/admin/users/'+u.id,'PATCH',values,'密码已重置，该账号所有会话已注销');await load();close();}}/>)}>重置密码</button></div></td></tr>)}</tbody></table></div>}</Panel><Panel title="最近操作审计（最多 200 条）">{admin&&<div className="table-scroll audit-scroll"><table className="business-table"><thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>资源编号</th></tr></thead><tbody>{admin.audit.map(a=><tr key={a.id}><td>{date(a.created_at)}</td><td>{a.actor||a.actor_id}</td><td>{a.action}</td><td><code>{a.resource_id}</code></td></tr>)}</tbody></table></div>}</Panel></>}</>;
}
