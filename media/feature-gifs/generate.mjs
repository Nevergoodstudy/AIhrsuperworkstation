import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {mkdtemp,mkdir,writeFile,rm,stat} from 'node:fs/promises';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {createApp} from '../../server/app.mjs';
import {id,now,hashPassword} from '../../server/security.mjs';
import {installRenderer} from './renderer.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=path.join(root,'output/gifs'),ffmpeg=process.env.FFMPEG_BIN||'ffmpeg';
const temp=await mkdtemp(path.join(os.tmpdir(),'talentdesk-feature-gifs-'));
const assets={},shots={},assertions=[],pageErrors=[],LF=String.fromCharCode(10);
let browser,server,service;
await mkdir(output,{recursive:true});
const log=message=>console.log(new Date().toISOString()+' '+message);
async function command(args){
  const child=spawn(ffmpeg,args,{stdio:['ignore','ignore','pipe']});
  let error='';child.stderr.on('data',chunk=>{error+=chunk;});
  const [code]=await once(child,'close');if(code!==0)throw new Error('ffmpeg failed: '+error);
}
async function focus(locator,offset=90){
  await locator.evaluate((element,margin)=>{const dialog=element.closest('dialog'),box=element.getBoundingClientRect();if(dialog)dialog.scrollTop+=box.top-dialog.getBoundingClientRect().top-margin;else window.scrollTo(0,window.scrollY+box.top-margin);},offset);
}
async function capture(key,page,target){
  await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const box=target?await target.boundingBox():null,png=await page.screenshot({animations:'disabled',caret:'hide'});
  assets[key]='data:image/png;base64,'+png.toString('base64');
  shots[key]={asset:key,box:box?{x:box.x,y:box.y,width:box.width,height:box.height}:null,cursor:box?{x:Math.min(1165,box.x+box.width-16),y:Math.max(25,Math.min(610,box.y+24))}:null};
  log('Captured '+key);
}
function shot(key,duration,chapter,role,title,subtitle,caption){return {...shots[key],duration,chapter,role,title,subtitle,caption};}
async function nav(page,name){await page.getByRole('navigation').getByRole('button',{name,exact:typeof name==='string'}).click();await page.evaluate(()=>window.scrollTo(0,0));}

try{
  service=createApp({env:'test',dataDir:path.join(temp,'database'),appUrl:'http://127.0.0.1:1',company:'TalentDesk 演示工作区',aiKey:'',aiModel:'',smtpUrl:'',mailFrom:''});
  assert.equal(service.config.aiKey,'');assert.equal(service.config.smtpUrl,'');
  server=service.app.listen(0,'127.0.0.1');await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;service.config.appUrl=origin;
  const password=randomBytes(24).toString('base64url'),passwordHash=await hashPassword(password);
  for(const [role,name,department] of [['hr','演示 HR',''],['department','技术部复核人','技术部'],['admin','演示管理员','']])service.db.prepare('INSERT INTO users(id,name,email,password_hash,role,department,must_change,created_at) VALUES(?,?,?,?,?,?,0,?)').run(id(),name,role+'@example.test',passwordHash,role,department,now());
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
  const options={viewport:{width:1200,height:650},deviceScaleFactor:1,locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'reduce'};
  const hr=await browser.newContext(options),department=await browser.newContext(options),admin=await browser.newContext(options),candidate=await browser.newContext(options);
  async function api(context,route,method='GET',body){const response=await context.request.fetch(origin+route,{method,data:body,headers:{Origin:origin,'X-Requested-With':'TalentDesk'}});if(!response.ok())throw new Error(method+' '+route+' '+response.status()+' '+await response.text());return response.json();}
  for(const [context,role] of [[hr,'hr'],[department,'department'],[admin,'admin']])await api(context,'/api/auth/login','POST',{email:role+'@example.test',password});
  const job=await api(hr,'/api/jobs','POST',{title:'高级后端工程师',department:'技术部',location:'上海 · 混合办公',description:'负责订单服务设计、可靠性保障与业务开发；与产品及运营协作，沉淀可复核的技术方案。',requirements:['Node.js','SQL','幂等','可观测性'],status:'招聘中'});
  const productJob=await api(hr,'/api/jobs','POST',{title:'产品经理',department:'产品部',location:'上海',description:'开展用户研究，整理需求与产品方案，协作推进业务验证。',requirements:['需求分析','用户研究'],status:'招聘中'});
  await api(hr,'/api/jobs','POST',{title:'招聘专员',department:'人力资源部',location:'杭州',description:'协助推进招聘流程、沟通面试并维护候选人授权记录。',requirements:['招聘','沟通'],status:'招聘中'});
  const question=await api(hr,'/api/questions','POST',{title:'订单发生重复回调时，你会如何保证只处理一次？',competency:'可靠性设计',type:'情景题',level:'进阶',minutes:15,rubric:'1 分：缺少可行方案；3 分：说明幂等键与去重；5 分：覆盖事务、故障恢复和监控，并解释设计取舍。',active:true});
  await api(hr,'/api/assessments','POST',{jobId:job.id,name:'订单可靠性 · 岗位测评',duration:30,questionIds:[question.id],allowAI:false,randomize:false,recordSwitch:false});
  const resumeText=['以下为虚构演示简历，不对应真实求职者。','使用 Node.js 维护订单服务。','使用 SQL 进行业务查询与事务处理。','通过幂等键防止支付回调重复处理，保留重试记录。'].join(LF);
  const person=await api(hr,'/api/candidates','POST',{jobId:job.id,name:'林示例',email:'lin.demo@example.test',phone:'',resumeText,consent:true});
  await api(hr,'/api/candidates','POST',{jobId:productJob.id,name:'周演示',email:'zhou.demo@example.test',phone:'',resumeText:'虚构演示资料：负责需求分析、用户研究与产品方案。',consent:true});
  await api(hr,'/api/candidates','POST',{jobId:job.id,name:'陈演示',email:'chen.demo@example.test',phone:'',resumeText:'虚构演示资料：使用 Node.js 和 SQL 开发业务服务。',consent:true});
  const h=await hr.newPage(),d=await department.newPage(),a=await admin.newPage(),p=await candidate.newPage();
  for(const page of [h,d,a,p]){page.setDefaultTimeout(12000);page.on('pageerror',error=>pageErrors.push(error.message));}
  await h.goto(origin);await expect(h.getByRole('heading',{name:'招聘工作概览',exact:true})).toBeVisible();await capture('dashboard',h,h.locator('.metrics-row'));
  await nav(h,'招聘岗位');
  await h.locator('.panel').filter({has:h.getByRole('heading',{name:'高级后端工程师',exact:true})}).getByRole('button',{name:'编辑岗位',exact:true}).click();
  await focus(h.getByLabel('筛选要求',{exact:false}),180);await capture('requirements',h,h.getByLabel('筛选要求',{exact:false}));
  await h.getByRole('button',{name:'关闭弹窗'}).click();await nav(h,/^候选人/);await capture('candidates',h,h.locator('.business-table'));
  await h.getByRole('row').filter({hasText:'林示例'}).getByRole('button',{name:'查看资料'}).click();
  const evidence=h.getByRole('heading',{name:'简历证据分析',exact:true});
  await expect(h.getByText('岗位关键词覆盖（仅辅助筛选）：75%',{exact:true})).toBeVisible();await focus(evidence,88);await capture('evidence',h,h.locator('.panel').filter({has:evidence}));
  const missing=h.getByText('未找到证据 · 可观测性',{exact:true});await focus(missing,320);await capture('evidence-missing',h,missing);
  assertions.push('关键词覆盖为 75%，原文证据及未命中项均可见；覆盖率不是录用分。');
  await h.getByRole('button',{name:'发起测评',exact:true}).click();await capture('invitation',h,h.getByRole('dialog'));
  await h.getByRole('button',{name:'创建专属邀请',exact:true}).click();const inviteUrl=await h.getByLabel('候选人专属邀请链接').inputValue();assert.ok(inviteUrl.includes('#/invite/'));
  // The private invitation credential is used only in memory and is never captured.
  await p.goto(inviteUrl);await expect(p.getByRole('heading',{name:'林示例，您好',exact:true})).toBeVisible();await p.evaluate(()=>window.scrollTo(0,0));await capture('consent',p,p.locator('.exam-facts'));
  const consent=p.getByLabel('我已阅读测评规则',{exact:false});await consent.check();await focus(consent,475);await capture('consent-checked',p,consent.locator('..'));
  await p.getByRole('button',{name:'同意并开始测评',exact:true}).click();
  const answer=p.getByLabel('第 1 题答案',{exact:true});await expect(answer).toBeVisible();await p.evaluate(()=>window.scrollTo(0,0));await capture('exam-empty',p,p.getByRole('timer'));
  const parts=['先使用业务幂等键与 SQL 唯一约束识别重复请求。',LF+'将订单状态更新与处理记录放入同一事务，失败时回滚。',LF+'对临时故障设置重试队列，并记录日志与告警，便于人工核实。'];let text='';
  for(let i=0;i<parts.length;i++){text+=parts[i];await answer.fill(text);await p.evaluate(()=>window.scrollTo(0,0));await capture('typing-'+i,p,answer);}
  await expect(p.getByText(/^已保存 ·/)).toBeVisible();await capture('saved',p,p.locator('.save-status'));
  await p.reload();await expect(p.getByLabel('第 1 题答案',{exact:true})).toHaveValue(text);await p.evaluate(()=>window.scrollTo(0,0));await capture('restored',p,p.locator('.save-status'));
  assertions.push('作答自动保存成功，刷新后完整答案与保存前一致。');
  await p.getByRole('button',{name:'提交测评',exact:true}).click();await p.getByRole('button',{name:'确认提交',exact:true}).click();await expect(p.getByRole('heading',{name:'测评已提交',exact:true})).toBeVisible();await p.evaluate(()=>window.scrollTo(0,0));await capture('submitted',p,p.getByRole('heading',{name:'测评已提交',exact:true}));
  await d.goto(origin);await nav(d,'测评与复核');await d.getByRole('button',{name:'查看测评',exact:true}).click();await d.getByText('评分要点',{exact:true}).click();
  await d.getByLabel('本题评分（1 最低，5 最高）').selectOption('4');await focus(d.locator('.answer-review'),72);await capture('ratings',d,d.locator('.answer-review'));
  await d.getByLabel('推进建议（仅内部可见）').selectOption('建议面试');const internalNote='能说明幂等、事务与故障重试；建议面试时进一步核实监控和恢复细节。';await d.getByLabel('人工复核说明（仅内部可见）').fill(internalNote);await focus(d.getByLabel('推进建议（仅内部可见）'),100);await capture('review-note',d,d.getByLabel('人工复核说明（仅内部可见）'));
  await d.getByRole('button',{name:'保存我的人工复核',exact:true}).click();await expect(d.getByText('技术部复核人 · 建议面试',{exact:true})).toBeVisible();await focus(d.getByRole('heading',{name:'人工复核记录（1 份）'}),105);await capture('review-saved',d,d.getByText('技术部复核人 · 建议面试',{exact:true}));
  await h.getByRole('button',{name:'关闭弹窗'}).click();await nav(h,'测评与复核');await h.getByRole('button',{name:'查看测评',exact:true}).click();
  const feedback=h.getByLabel('向候选人发布的反馈',{exact:false});await feedback.fill('感谢参与。您的方案覆盖了幂等与事务处理，我们将联系您进一步核实设计思路并安排下一轮沟通。');await focus(feedback,200);await capture('publish',h,feedback);
  await h.getByRole('button',{name:'发布反馈给候选人',exact:true}).click();await expect(h.getByRole('heading',{name:'已发布给候选人的反馈',exact:true})).toBeVisible();
  await p.getByRole('button',{name:'刷新反馈',exact:true}).click();await expect(p.getByText('人工评分：80 / 100',{exact:true})).toBeVisible();await expect(p.getByText(internalNote,{exact:true})).toHaveCount(0);await p.evaluate(()=>window.scrollTo(0,0));await capture('feedback',p,p.locator('.panel').filter({has:p.getByRole('heading',{name:'企业已发布反馈',exact:true})}).last());
  assertions.push('部门逐题人工评分 4/5；HR 发布后候选人可见 80/100 与公开反馈，内部评语不可见。');
  await d.getByRole('button',{name:'关闭弹窗'}).click();await nav(d,/^候选人/);await expect(d.getByRole('row').filter({hasText:'周演示'})).toHaveCount(0);await expect(d.getByRole('row').filter({hasText:'林示例'})).toBeVisible();await capture('department-list',d,d.locator('.business-table'));
  await d.getByRole('row').filter({hasText:'林示例'}).getByRole('button',{name:'查看资料'}).click();const privacy=d.getByText('部门账号仅查看本部门候选人的筛选证据及测评答卷，联系方式与简历原件不开放。',{exact:true});await expect(privacy).toBeVisible();await focus(privacy,375);await capture('privacy',d,privacy);
  const limited=await api(department,'/api/candidates/'+person.id);assert.equal(limited.email,undefined);assert.equal(limited.resumeText,undefined);const forbidden=await department.request.get(origin+'/api/candidates/'+person.id+'/resume');assert.equal(forbidden.status(),403);
  assertions.push('技术部列表不含产品部候选人；部门详情接口不返回联系方式或完整简历；原件接口返回 403。');
  await a.goto(origin);await nav(a,'设置与账号');const accounts=a.getByRole('heading',{name:'企业账号',exact:true});await expect(accounts).toBeVisible();await focus(accounts,130);await capture('accounts',a,a.locator('.panel').filter({has:accounts}));
  const audit=a.getByRole('heading',{name:'最近操作审计（最多 200 条）',exact:true});await focus(audit,110);await capture('audit',a,audit);assert.deepEqual(pageErrors,[]);
  assertions.push('真实浏览器流程无页面脚本错误；外部 AI 和 SMTP 已禁用；临时数据库与业务库隔离。');log('Real UI flow verified; rendering animations');

  const intro={intro:true,title:'让招聘判断，有据可循。',subtitle:'TalentDesk 招聘工作台 · 核心功能总览',duration:2.5};
  const outro={intro:true,outro:true,title:'整理交给工具，判断留给人。',subtitle:'岗位 → 证据 → 测评 → 复核 → 反馈',duration:2.5};
  const L={
    dashboard:shot('dashboard',2.3,1,'HR 工作区','招聘进展，一处掌握','岗位、候选人、进行中测评与待复核状态集中呈现','工作区展示实际记录；画面中的业务资料均为虚构。'),
    requirements:shot('requirements',2.4,1,'HR 工作区','先明确岗位，再对照证据','岗位要求可维护；后续简历线索按要求逐项展开','本例岗位要求：Node.js、SQL、幂等、可观测性。'),
    candidates:shot('candidates',2.2,1,'HR 工作区','候选人资料，集中跟进','按岗位与阶段筛选，进入资料即可查看证据','支持授权后导入简历；本片采用虚构正文资料。'),
    evidence:shot('evidence',3.5,2,'HR 工作区','每条线索，都能回到原文','逐项展示岗位要求、命中状态和对应简历引用','75% 是关键词覆盖率，不是录用分，也不替代人工判断。'),
    missing:shot('evidence-missing',2.4,2,'HR 工作区','没找到证据，也如实呈现','保留未命中要求，帮助安排后续核实','未找到证据不代表没有能力；本例缺少可观测性线索。'),
    consent:shot('consent',2.3,3,'候选人门户','测评开始前，先说明规则','题目数量、时限、资料处理与 AI 使用规则清楚告知','候选人从独立入口进入；开始后由服务器计时。'),
    agreed:shot('consent-checked',1.8,3,'候选人门户','阅读规则，自主确认开始','获得同意后开始测评，作答规则在前','本例不允许 AI、不记录切屏，具体规则由企业配置。'),
    empty:shot('exam-empty',1.7,3,'候选人门户','独立作答，限时完成','页面显示实际剩余时间与答案保存状态','刷新页面不会重置服务端计时。'),
    type0:shot('typing-0',0.65,3,'候选人门户','专注表达，答案自动保存','结合业务题目输入思路，界面同步保存状态','作答为虚构演示；操作顺序真实，展示节奏经过剪辑。'),
    type1:shot('typing-1',0.65,3,'候选人门户','专注表达，答案自动保存','结合业务题目输入思路，界面同步保存状态','作答为虚构演示；操作顺序真实，展示节奏经过剪辑。'),
    type2:shot('typing-2',1.25,3,'候选人门户','专注表达，答案自动保存','结合业务题目输入思路，界面同步保存状态','作答为虚构演示；操作顺序真实，展示节奏经过剪辑。'),
    saved:shot('saved',2,3,'候选人门户','看到“已保存”，再继续','答案写入临时演示服务器，保存状态可核对','断网或保存失败时请保留页面，本地输入不等于已提交。'),
    restored:shot('restored',2.3,3,'候选人门户','刷新之后，答案仍在','重新载入页面，读取服务端已保存的答案','已核对：刷新后的完整答案与保存前一致。'),
    submitted:shot('submitted',2.3,3,'候选人门户','完成提交，等待人工复核','提交后不可修改；反馈由 HR 审核后发布','系统不会自动作出录用或淘汰决定。'),
    ratings:shot('ratings',2.8,4,'用人部门工作区','对照答卷，逐题人工评分','原答案与企业评分要点同屏核实，按 1–5 分记录','演示评分 4/5，由复核人手动选择，不是 AI 自动评分。'),
    note:shot('review-note',2.2,4,'用人部门工作区','评分之外，保留判断依据','记录推进建议和人工复核说明，供内部协作','内部建议与评语不会直接作为候选人可见反馈发送。'),
    publish:shot('publish',2.5,4,'HR 工作区','HR 核查后，再发布反馈','候选人可见的反馈由 HR 单独撰写和发布','发布后评分锁定；如需修改，HR 可先撤回反馈。'),
    feedback:shot('feedback',3,4,'候选人门户','公开反馈，回到候选人','候选人查看已发布文字与人工评分','80/100 来自演示人工评分换算；内部评语不向候选人展示。'),
    department:shot('department-list',2.5,5,'用人部门工作区','各有职责，各见所需','技术部仅查看本部门候选人和测评','服务端逐请求校验权限；画面不含其他部门候选人。'),
    privacy:shot('privacy',3.1,5,'用人部门工作区','证据可协作，资料有边界','用人部门可复核证据和答卷，联系方式与原件不开放','已验证部门接口权限；文本脱敏仍需 HR 人工检查。'),
    accounts:shot('accounts',2.6,5,'管理员工作区','角色权限，由企业管理','管理员维护企业账号，HR 与用人部门分工协作','系统面向单企业使用；画面账号全部为临时演示账号。'),
    audit:shot('audit',3.5,5,'管理员工作区','关键操作，留有记录','管理员可查看最近的操作审计，最多 200 条','正式上线仍需完成服务器、HTTPS 与相关服务部署验收。')
  };
  const films=[
    {name:'talentdesk-overview',title:'TalentDesk 核心功能总览',shots:[intro,L.dashboard,L.requirements,L.evidence,L.consent,L.type2,L.saved,L.ratings,L.feedback,L.privacy,outro]},
    {name:'01-resume-evidence',title:'岗位与简历原文证据',shots:[L.requirements,L.candidates,L.evidence,L.missing]},
    {name:'02-candidate-assessment',title:'候选人测评与自动保存',shots:[L.consent,L.agreed,L.empty,L.type0,L.type1,L.type2,L.saved,L.restored,L.submitted]},
    {name:'03-human-review-feedback',title:'人工复核与反馈发布',shots:[L.ratings,L.note,L.publish,L.feedback]},
    {name:'04-roles-privacy',title:'角色权限与操作审计',shots:[L.department,L.privacy,L.accounts,L.audit]}
  ];
  const rendering=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:1}),canvas=await rendering.newPage();await canvas.goto('about:blank');await canvas.evaluate(installRenderer,{assets});
  const manifest={project:'TalentDesk',createdAt:new Date().toISOString(),method:'真实应用关键状态截图，叠加标题、标注、光标运动和转场；展示节奏经过剪辑，并非未经剪辑的连续屏幕录制。',demoData:'全部资料、账号、答卷和评分均为虚构演示；使用隔离临时数据库；未调用外部 AI 或发送邮件。',assertions,files:[]};
  for(const film of films){
    const fps=12,total=film.shots.reduce((sum,s)=>sum+s.duration,0),count=Math.ceil(total*fps),intermediate=path.join(temp,film.name+'.mkv'),palette=path.join(temp,film.name+'-palette.png');
    const encoder=spawn(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate',String(fps),'-vcodec','png','-i','pipe:0','-an','-c:v','libx264','-preset','ultrafast','-crf','0','-pix_fmt','yuv444p',intermediate],{stdio:['pipe','ignore','pipe']});
    let encodingError='';encoder.stderr.on('data',chunk=>{encodingError+=chunk;});const encodingClosed=once(encoder,'close');
    const boundaries=[];let cumulative=0;for(const s of film.shots){boundaries.push(cumulative);cumulative+=s.duration;}
    log('Rendering '+film.name+' ('+count+' frames)');
    for(let frame=0;frame<count;frame++){
      const time=frame/fps;let index=film.shots.length-1;for(let i=0;i<film.shots.length;i++)if(time<boundaries[i]+film.shots[i].duration){index=i;break;}
      const b64=await canvas.evaluate(args=>{window.renderFeatureFrame(args);return document.querySelector('canvas').toDataURL('image/png').split(',')[1];},{shot:film.shots[index],previous:film.shots[index-1],localTime:time-boundaries[index],globalTime:time,totalTime:total,segmentIndex:index,segmentCount:film.shots.length});
      const png=Buffer.from(b64,'base64');if(frame===Math.round(fps*1.3))await writeFile(path.join(output,film.name+'-poster.png'),png);if(!encoder.stdin.write(png))await once(encoder.stdin,'drain');if(frame%120===0)log(film.name+' '+frame+'/'+count);
    }
    encoder.stdin.end();const [code]=await encodingClosed;if(code!==0)throw new Error(encodingError);
    await command(['-hide_banner','-loglevel','error','-y','-i',intermediate,'-vf','palettegen=stats_mode=diff:max_colors=224:reserve_transparent=1','-frames:v','1','-update','1',palette]);
    const filename=film.name+'.gif';await command(['-hide_banner','-loglevel','error','-y','-i',intermediate,'-i',palette,'-lavfi','paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle','-loop','0','-gifflags','+transdiff',path.join(output,filename)]);
    const bytes=(await stat(path.join(output,filename))).size;manifest.files.push({file:filename,title:film.title,width:1280,height:900,fps,frames:count,durationSeconds:Number((count/fps).toFixed(2)),bytes,loop:0,poster:film.name+'-poster.png'});log('Encoded '+filename+' '+(bytes/1048576).toFixed(2)+' MiB');
    if(film.name==='talentdesk-overview'){
      const compactPalette=path.join(temp,'compact-palette.png'),compact=path.join(output,'talentdesk-overview-compact.gif');
      await command(['-hide_banner','-loglevel','error','-y','-i',intermediate,'-vf','fps=8,scale=960:675:flags=lanczos,palettegen=stats_mode=diff:max_colors=192','-frames:v','1','-update','1',compactPalette]);
      await command(['-hide_banner','-loglevel','error','-y','-i',intermediate,'-i',compactPalette,'-lavfi','[0:v]fps=8,scale=960:675:flags=lanczos[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle','-loop','0','-gifflags','+transdiff',compact]);
      manifest.files.push({file:path.basename(compact),title:'核心功能总览 · 轻量版',width:960,height:675,fps:8,bytes:(await stat(compact)).size,loop:0,poster:film.name+'-poster.png'});
    }
  }
  await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+LF);log('Completed all GIFs: '+output);
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));service?.close();await rm(temp,{recursive:true,force:true});}
