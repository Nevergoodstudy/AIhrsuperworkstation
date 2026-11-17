import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { id, now, hashPassword } from '../server/security.mjs';
export const origin='http://localhost:5173';
export const password='Test-only-password!2026';
export async function fixture(extra={}) {
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'talent-test-'));
  const service=createApp({dataDir,env:'test',appUrl:origin,...extra});
  const accounts={};
  for(const [role,department] of [['admin',''],['hr',''],['department','技术部'],['other','财务部']]) { const key=id();accounts[role]={id:key,email:role+'@example.test'};service.db.prepare('INSERT INTO users(id,name,email,password_hash,role,department,must_change,created_at) VALUES(?,?,?,?,?,?,0,?)').run(key,role,accounts[role].email,await hashPassword(password),role==='other'?'department':role,department,now()); }
  let server=service.app.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  function client(){let cookie='',examId;return {async call(route,method='GET',body,headers={}){const response=await fetch(base+route,{method,headers:{Origin:origin,'X-Requested-With':'TalentDesk',...(cookie?{Cookie:cookie}:{}),...(examId&&route.startsWith('/api/portal/')&&route!=='/api/portal/redeem'?{'X-Exam-Id':examId}:{}),...(body && !(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});const set=response.headers.getSetCookie();if(set.length)cookie=set.map(s=>s.split(';')[0]).join('; ');const type=response.headers.get('content-type')||'';const value=type.includes('json')?await response.json():await response.text();if(route==='/api/portal/redeem'&&response.ok)examId=value.id;return {status:response.status,body:value,headers:response.headers};},async login(role='hr'){return this.call('/api/auth/login','POST',{email:accounts[role].email,password});}};}
  return {...service,dataDir,accounts,client,base,async cleanup(){await new Promise(resolve=>server.close(resolve));service.close();await rm(dataDir,{recursive:true,force:true});}};
}
export async function setupBusiness(client){
  const job=await client.call('/api/jobs','POST',{title:'后端工程师',department:'技术部',location:'上海',description:'负责企业业务服务开发',requirements:['Node.js','SQL'],status:'招聘中'});
  const question=await client.call('/api/questions','POST',{title:'请设计一个可靠的订单处理流程',competency:'系统设计',type:'情景题',level:'进阶',minutes:15,rubric:'1 分无可行方案；3 分覆盖主流程；5 分覆盖幂等、重试和监控',active:true});
  const assessment=await client.call('/api/assessments','POST',{jobId:job.body.id,name:'后端业务测评',duration:60,questionIds:[question.body.id],allowAI:false,randomize:true,recordSwitch:true});
  const candidate=await client.call('/api/candidates','POST',{jobId:job.body.id,name:'测试候选人',email:'candidate@example.test',phone:'13800138000',resumeText:'我使用 Node.js 开发业务服务。请联系 candidate@example.test，电话 13800138000。',consent:true});
  for(const result of [job,question,assessment,candidate])if(result.status!==201)throw new Error(JSON.stringify(result));
  return {jobId:job.body.id,questionId:question.body.id,assessmentId:assessment.body.id,candidateId:candidate.body.id};
}
export async function invite(client,business,sendEmail=false){const r=await client.call('/api/exams','POST',{candidateId:business.candidateId,assessmentId:business.assessmentId,validDays:7,sendEmail});if(r.status!==201)throw new Error(JSON.stringify(r));return {...r.body,token:r.body.inviteUrl.split('/').pop()};}
