import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fixture, setupBusiness, invite, password } from './helpers.mjs';
import { id, now, hashPassword } from '../server/security.mjs';
import { openDatabase } from '../server/db.mjs';
test('招聘完整闭环：HR、独立候选人和部门账号',async t=>{
 const f=await fixture();t.after(()=>f.cleanup());const hr=f.client(),dept=f.client(),portal=f.client(),outsider=f.client();
 assert.equal((await hr.login()).status,200);await dept.login('department');await outsider.login('other');
 const b=await setupBusiness(hr), link=await invite(hr,b);
 assert.equal((await hr.call('/api/exams','POST',{candidateId:b.candidateId,assessmentId:b.assessmentId})).status,409);
 assert.equal((await portal.call('/api/exams/'+link.id)).status,401);
 const initial=await portal.call('/api/portal/redeem','POST',{token:link.token});assert.equal(initial.status,200);assert.equal(initial.body.questions,undefined);assert.equal(initial.body.candidateId,undefined);assert.equal(initial.body.token,undefined);
 assert.equal((await portal.call('/api/portal/start','POST',{consent:false})).status,400);
 const start=await portal.call('/api/portal/start','POST',{consent:true});assert.equal(start.status,200);assert.equal(start.body.questions.length,1);assert.equal(start.body.questions[0].rubric,undefined);const deadline=start.body.deadlineAt;
 await hr.call('/api/questions/'+b.questionId,'PUT',{version:1,title:'更换后的题目不能影响旧测评',competency:'修改项',type:'简答题',level:'基础',minutes:5,rubric:'修改后的评分',active:false});
 assert.deepEqual((await hr.call('/api/exams/'+link.id)).body.answers,{});
 assert.deepEqual((await dept.call('/api/exams/'+link.id)).body.questions,[]);
 const answers={[b.questionId]:'使用幂等键与事务处理订单，重试失败任务。联系方式 candidate@example.test 13800138000'};
 let saved=await portal.call('/api/portal/answers','PUT',{revision:0,answers,usedAI:true});assert.equal(saved.status,200);assert.equal(saved.body.revision,1);
 const reload=await portal.call('/api/portal/me');assert.deepEqual(reload.body.answers,answers);assert.equal(reload.body.deadlineAt,deadline);assert.equal(reload.body.usedAI,true);assert.match(reload.body.questions[0].title,/订单/);
 assert.equal((await portal.call('/api/portal/answers','PUT',{revision:0,answers})).status,409);
 assert.equal((await portal.call('/api/portal/answers','PUT',{revision:1,answers:{[id()]:'注入无效题号'}})).status,400);
 const eventId=id();await portal.call('/api/portal/events','POST',{eventId});await portal.call('/api/portal/events','POST',{eventId});
 saved=await portal.call('/api/portal/submit','POST',{revision:1,answers,usedAI:true});assert.equal(saved.status,200);assert.equal(saved.body.status,'submitted');
 assert.equal((await portal.call('/api/portal/answers','PUT',{revision:2,answers})).status,409);
 const viewed=await dept.call('/api/exams/'+link.id);assert.equal(viewed.status,200);assert.equal(viewed.body.switchCount,1);assert.match(viewed.body.answers[b.questionId],/隐藏/);assert.doesNotMatch(JSON.stringify(viewed.body),/candidate@example|13800138000/);
 assert.equal((await outsider.call('/api/exams/'+link.id)).status,404);assert.equal((await outsider.call('/api/candidates/'+b.candidateId)).status,404);
 const candidate=await dept.call('/api/candidates/'+b.candidateId);assert.equal(candidate.body.email,undefined);assert.equal(candidate.body.resumeText,undefined);assert.equal(candidate.body.version,4);assert.equal(candidate.body.analysis.score,50);
 assert.equal((await dept.call('/api/candidates/'+b.candidateId+'/resume')).status,403);
 assert.equal((await dept.call('/api/jobs','POST',{})).status,403);assert.equal((await dept.call('/api/export/candidates')).status,403);
 assert.equal((await hr.call('/api/exams/'+link.id+'/feedback','POST',{message:'提前发布'})).status,409);
 assert.equal((await dept.call('/api/exams/'+link.id+'/review','PUT',{version:0,ratings:{},recommendation:'建议面试',note:'缺少评分'})).status,400);
 assert.equal((await dept.call('/api/exams/'+link.id+'/review','PUT',{version:0,ratings:{[b.questionId]:4},recommendation:'建议面试',note:'方案覆盖幂等和失败重试，可在面试中核实。'})).status,200);
 assert.equal((await dept.call('/api/exams/'+link.id+'/review','PUT',{version:0,ratings:{[b.questionId]:1},recommendation:'不建议推进',note:'过期版本'})).status,409);
 assert.equal((await dept.call('/api/exams/'+link.id+'/feedback','POST',{message:'越权'})).status,403);
 assert.equal((await hr.call('/api/exams/'+link.id+'/feedback','POST',{message:'感谢参与，后续安排面试。'})).status,200);
 const result=await portal.call('/api/portal/me');assert.equal(result.body.feedback.score,80);assert.match(result.body.feedback.message,/面试/);assert.equal(result.body.reviews,undefined);assert.doesNotMatch(JSON.stringify(result.body),/面试中核实|rubric/);
 assert.equal((await dept.call('/api/exams/'+link.id+'/review','PUT',{version:0,ratings:{[b.questionId]:5},recommendation:'建议面试',note:'修改'})).status,409);
 assert.equal((await hr.call('/api/exams/'+link.id+'/feedback','DELETE')).status,200);assert.equal((await portal.call('/api/portal/me')).body.feedback,null);
 const otherWorkspace=await outsider.call('/api/workspace');assert.equal(otherWorkspace.body.candidates.length,0);assert.equal(otherWorkspace.body.jobs.length,0);
 const csv=await hr.call('/api/export/candidates');assert.equal(csv.status,200);assert.match(csv.body,/测试候选人/);
});
test('登录、CSRF、强制改密、停用和会话失效',async t=>{
 const f=await fixture();t.after(()=>f.cleanup());const admin=f.client(),newUser=f.client();
 assert.equal((await admin.call('/api/auth/login','POST',{email:'admin@example.test',password},{Origin:'https://evil.test'})).status,403);
 assert.equal((await admin.call('/api/auth/login','POST',{email:'admin@example.test',password:'bad'})).status,401);await admin.login('admin');
 const r=await admin.call('/api/admin/users','POST',{name:'新 HR',email:'new@example.test',password,role:'hr',department:''});assert.equal(r.status,201);
 assert.equal((await newUser.call('/api/auth/login','POST',{email:'new@example.test',password})).body.user.mustChange,true);assert.equal((await newUser.call('/api/workspace')).status,403);
 assert.equal((await newUser.call('/api/auth/password','POST',{current:password,password:'Replacement-password!2026'})).status,200);assert.equal((await newUser.call('/api/auth/me')).status,401);
 await newUser.call('/api/auth/login','POST',{email:'new@example.test',password:'Replacement-password!2026'});assert.equal((await newUser.call('/api/workspace')).status,200);
 assert.equal((await admin.call('/api/admin/users/'+r.body.id,'PATCH',{active:false})).status,200);assert.equal((await newUser.call('/api/auth/me')).status,401);
 assert.equal((await admin.call('/api/admin/users/'+f.accounts.admin.id,'PATCH',{active:false})).status,400);
 assert.equal((await admin.call('/api/admin/users','POST',{name:'无部门',email:'bad@example.test',password,role:'department',department:''})).status,400);
 assert.equal((await admin.call('/api/auth/logout','POST')).status,200);assert.equal((await admin.call('/api/admin')).status,401);
});
test('管理员审计以资源编号及 UTC 日期筛选较旧的记录', async t => {
 const f = await fixture(); t.after(() => f.cleanup());
 const admin = f.client(), hr = f.client(), department = f.client();
 await admin.login('admin'); await hr.login(); await department.login('department');
 const target = id();
 f.db.prepare(`
   INSERT INTO audit(actor_id,action,resource_id,created_at) VALUES
   (?, 'exam.revoke', ?, '2020-01-02T00:00:00.000Z'),
   (?, 'feedback.retract', ?, '2020-01-02T23:59:59.999Z'),
   (?, 'exam.revoke', ?, '2020-01-03T00:00:00.000Z'),
   (?, 'job.update', ?, '2020-01-02T12:00:00.000Z')
 `).run(f.accounts.hr.id, target, f.accounts.hr.id, target, f.accounts.hr.id, target, f.accounts.hr.id, id());
 f.db.exec(`
   WITH RECURSIVE entries(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM entries WHERE n<201)
   INSERT INTO audit(actor_id,action,resource_id,created_at)
   SELECT 'system','test.newer','newer','2020-01-04T00:00:00.000Z' FROM entries
 `);
 const unfiltered = await admin.call('/api/admin');
 assert.equal(unfiltered.body.audit.length, 200);
 assert.ok(!unfiltered.body.audit.some(row => row.resource_id === target));
 const start = '/api/admin?' + new URLSearchParams({ resourceId: target, from: '2020-01-02', to: '2020-01-02' });
 const result = await admin.call(start);
 assert.equal(result.status, 200);
 assert.deepEqual(result.body.audit.map(row => row.action), ['feedback.retract', 'exam.revoke']);
 assert.equal((await admin.call('/api/admin?from=2020-01-03&to=2020-01-02')).status, 400);
 assert.equal((await admin.call('/api/admin?to=2020-02-31')).status, 400);
 assert.equal((await hr.call(start)).status, 403);
 assert.equal((await department.call(start)).status, 403);
});
test('服务器限时、到期邀请、撤销与版本冲突',async t=>{
 const f=await fixture();t.after(()=>f.cleanup());const hr=f.client(),p=f.client();await hr.login();const b=await setupBusiness(hr);let link=await invite(hr,b);
 f.db.prepare('UPDATE exams SET expires_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z',link.id);assert.equal((await p.call('/api/portal/redeem','POST',{token:link.token})).status,410);
 link=await invite(hr,b);await p.call('/api/portal/redeem','POST',{token:link.token});await p.call('/api/portal/start','POST',{consent:true});const answers={[b.questionId]:'截止前内容'};await p.call('/api/portal/answers','PUT',{revision:0,answers});
 f.db.prepare('UPDATE exams SET deadline_at=? WHERE id=?').run('2020-01-01T00:00:00.000Z',link.id);
 assert.equal((await p.call('/api/portal/submit','POST',{revision:1,answers:{[b.questionId]:'超时内容'},usedAI:false})).status,409);const ended=await p.call('/api/portal/me');assert.equal(ended.body.status,'submitted');assert.deepEqual(ended.body.answers,answers);
 link=await invite(hr,b);await p.call('/api/portal/redeem','POST',{token:link.token});assert.equal((await hr.call('/api/exams/'+link.id+'/revoke','POST')).status,200);assert.equal((await p.call('/api/portal/me')).status,401);assert.equal((await p.call('/api/portal/redeem','POST',{token:link.token})).status,410);
 const c=(await hr.call('/api/candidates/'+b.candidateId)).body;const edit={name:c.name,email:c.email,phone:c.phone,stage:'面试中',version:c.version};assert.equal((await hr.call('/api/candidates/'+c.id,'PUT',edit)).status,200);assert.equal((await hr.call('/api/candidates/'+c.id,'PUT',edit)).status,409);
});
test('原件私有存储、下载、删除及持久化',async t=>{
 const f=await fixture();t.after(()=>f.cleanup());const hr=f.client();await hr.login();const b=await setupBusiness(hr);
 const form=new FormData();for(const [key,value] of Object.entries({jobId:b.jobId,name:'上传候选人',email:'',phone:'',consent:'true'}))form.append(key,value);form.append('resume',new Blob(['Node.js experience and SQL projects.']), 'resume.txt');
 const r=await hr.call('/api/candidates/import','POST',form);assert.equal(r.status,201);const raw=f.db.prepare('SELECT * FROM candidates WHERE id=?').get(r.body.id);assert.equal((await readFile(path.join(f.dataDir,'resumes',raw.file_key))).toString(),'Node.js experience and SQL projects.');
 assert.equal((await hr.call('/api/candidates/'+r.body.id+'/resume')).status,200);
 const second=openDatabase(f.dataDir);assert.equal(second.prepare('SELECT count(*) AS n FROM candidates').get().n,2);second.close();
 assert.equal((await f.client().call('/data/resumes/'+raw.file_key)).body.includes('Node.js experience'),false);
 assert.equal((await hr.call('/api/candidates/'+r.body.id,'DELETE')).status,200);await assert.rejects(access(path.join(f.dataDir,'resumes',raw.file_key)));assert.equal(f.db.prepare('SELECT count(*) AS n FROM file_cleanup').get().n,0);
});
test('真实邮件状态由发送服务结果决定',async t=>{
 const messages=[];const f=await fixture({smtpUrl:'smtp://example.test',mailFrom:'HR <hr@example.test>',mailer:{async sendMail(message){messages.push(message);return {accepted:[message.to],rejected:[]};}}});t.after(()=>f.cleanup());const hr=f.client();await hr.login();const b=await setupBusiness(hr);const link=await invite(hr,b,true);assert.equal(link.mailStatus,'accepted');assert.equal(messages.length,1);assert.ok(messages[0].text.includes(link.inviteUrl));assert.equal(f.db.prepare('SELECT mail_status FROM exams WHERE id=?').get(link.id).mail_status,'accepted');
 await hr.call('/api/exams/'+link.id+'/revoke','POST');f.config.mailer={async sendMail(){throw Object.assign(new Error('password must not leak'), { responseCode: 550 });}};const failed=await invite(hr,b,true);assert.equal(failed.mailStatus,'failed');assert.doesNotMatch(failed.mailError,/password/);assert.ok(failed.inviteUrl);
});

test('邮件结果未知须核实后重发，并防止重复投递', async t => {
 const receiving = Promise.withResolvers(), release = Promise.withResolvers();
 let attempts = 0;
 const f = await fixture({
  smtpUrl: 'smtp://example.test', mailFrom: 'hr@example.test',
  mailer: { async sendMail() {
   attempts++;
   if (attempts === 1) throw new Error('synthetic private provider detail');
   receiving.resolve();
   await release.promise;
   return { accepted: ['candidate@example.test'] };
  }}
 });
 t.after(() => f.cleanup());
 const hr = f.client();
 assert.equal((await hr.login()).status, 200);
 const b = await setupBusiness(hr);
 const link = await invite(hr, b, true);
 assert.equal(link.mailStatus, 'unknown');
 assert.doesNotMatch(link.mailError, /private provider/);
 const route = '/api/exams/' + link.id + '/send';
 const send = confirmUnknown => hr.call(route, 'POST', { inviteToken: link.token, confirmUnknown });
 assert.equal((await send(false)).status, 409);
 assert.equal(attempts, 1);
 const retry = send(true);
 try {
  await Promise.race([receiving.promise, retry.then(() => assert.fail('邮件未开始发送'))]);
  assert.equal((await send(true)).status, 409);
 } finally { release.resolve(); }
 assert.equal((await retry).body.mailStatus, 'accepted');
 assert.equal((await send(true)).status, 409);
 assert.equal(attempts, 2);
 const history = (await hr.call('/api/exams/' + link.id)).body.operationalEvents;
 assert.deepEqual(history.map(item => item.details.mailStatus), ['accepted', 'unknown']);
 assert.doesNotMatch(JSON.stringify(history), /private provider/);
});

test('岗位、题目和测评方案的过期版本不会覆盖新数据',async t=>{
 const f=await fixture();t.after(()=>f.cleanup());const hr=f.client();await hr.login();await setupBusiness(hr);
 const workspace=(await hr.call('/api/workspace')).body;
 for(const [resource,record] of [['jobs',workspace.jobs[0]],['questions',workspace.questions[0]],['assessments',workspace.assessments[0]]]){
  assert.equal(record.version,1);assert.equal((await hr.call('/api/'+resource+'/'+record.id,'PUT',record)).status,200);
  assert.equal((await hr.call('/api/'+resource+'/'+record.id,'PUT',record)).status,409);
 }
});
test('并发创建同邮箱只成功一次，管理员并发停用仍保留有效账号',async t=>{
 const f=await fixture();t.after(()=>f.cleanup());const a=f.client(),b=f.client();await a.login('admin');
 const body={name:'并发账号',email:'race@example.test',password,role:'admin',department:''};
 const results=await Promise.all([a.call('/api/admin/users','POST',body),a.call('/api/admin/users','POST',body)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 const second=results.find(r=>r.status===201).body.id;
 await b.call('/api/auth/login','POST',{email:body.email,password});await b.call('/api/auth/password','POST',{current:password,password:'Concurrent-admin-password!2026'});await b.call('/api/auth/login','POST',{email:body.email,password:'Concurrent-admin-password!2026'});
 const changes=await Promise.all([a.call('/api/admin/users/'+second,'PATCH',{active:false,password}),b.call('/api/admin/users/'+f.accounts.admin.id,'PATCH',{active:false,password})]);
 assert.equal(changes.filter(r=>r.status===200).length,1);assert.equal(f.db.prepare('SELECT count(*) AS n FROM users WHERE role=? AND active=1').get('admin').n,1);
});
