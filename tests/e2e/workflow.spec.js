import { test, expect } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { setupBusiness, invite } from '../helpers.mjs';
async function login(page,role){await page.goto('/');await page.getByLabel('工作邮箱',{exact:true}).fill(role+'@example.test');await page.getByLabel('密码',{exact:true}).fill('E2e-only-password!2026');await page.getByRole('button',{name:'登录工作区',exact:true}).click();await expect(page.getByRole('heading',{name:'招聘工作概览'})).toBeVisible();}
test('三个独立身份通过界面完成招聘、作答、复核、发布反馈',async({browser,browserName},testInfo)=>{
 const hrContext=await browser.newContext({viewport:{width:1440,height:1000}}),candidateContext=await browser.newContext(),departmentContext=await browser.newContext();
 const hr=await hrContext.newPage(),p=await candidateContext.newPage(),dept=await departmentContext.newPage();const errors=[];for(const page of [hr,p,dept])page.on('pageerror',error=>errors.push(error.message));
 await login(hr,'hr');
 await hr.getByRole('button',{name:'招聘岗位',exact:true}).click();await hr.getByRole('button',{name:'创建岗位',exact:true}).click();let dialog=hr.getByRole('dialog');
 await dialog.getByLabel('岗位名称',{exact:true}).fill('真实业务后端工程师');await dialog.getByLabel('所属部门', {exact:false}).fill('技术部');await dialog.getByLabel('工作地点',{exact:true}).fill('上海');await dialog.getByLabel('岗位职责',{exact:true}).fill('负责订单系统的可靠性和业务开发。');await dialog.getByLabel('筛选要求', {exact:false}).fill('Node.js\nSQL');await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog).not.toBeVisible();
 await hr.getByRole('button',{name:'题库',exact:true}).click();await hr.getByRole('button',{name:'创建题目',exact:true}).click();dialog=hr.getByRole('dialog');await dialog.getByLabel('题目正文',{exact:true}).fill('如何避免订单重复处理？');await dialog.getByLabel('考察能力',{exact:true}).fill('可靠性设计');await dialog.getByLabel('人工评分要点',{exact:false}).fill('1 分无方案，3 分有去重思路，5 分有事务和故障恢复设计。 RUBRIC_REFERENCE');await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog).not.toBeVisible();
 await hr.getByRole('button',{name:'测评方案',exact:true}).click();await hr.getByRole('button',{name:'创建方案',exact:true}).click();dialog=hr.getByRole('dialog');await dialog.getByLabel('方案名称',{exact:true}).fill('订单可靠性测评');await dialog.getByLabel('如何避免订单重复处理？',{exact:false}).check();await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog).not.toBeVisible();
 await hr.getByRole('navigation').getByRole('button',{name:/^候选人/}).click();await hr.getByRole('button',{name:'新增 / 导入简历'}).click();dialog=hr.getByRole('dialog');await dialog.getByLabel('候选人姓名',{exact:true}).fill('闭环测试候选人');await dialog.getByLabel('邮箱（发送邮件邀请时必填）').fill('candidate@example.test');await dialog.getByLabel('电话',{exact:true}).fill('13800138000');await dialog.getByLabel('或粘贴简历正文').fill('拥有 Node.js 和 SQL 订单开发经验。');await dialog.getByLabel('已获得候选人授权',{exact:false}).check();await dialog.getByRole('button',{name:'保存候选人',exact:true}).click();await expect(dialog).not.toBeVisible();
 await hr.getByRole('button',{name:'查看资料',exact:true}).click();dialog=hr.getByRole('dialog');await expect(dialog.getByText('岗位关键词覆盖（仅辅助筛选）：100%')).toBeVisible();await dialog.getByRole('button',{name:'发起测评',exact:true}).click();dialog=hr.getByRole('dialog');await dialog.getByRole('button',{name:'创建专属邀请',exact:true}).click();const link=await dialog.getByLabel('候选人专属邀请链接').inputValue();expect(link).toMatch(/#\/invite\//);await expect(dialog.getByText('尚未发送邮件，请手动分享链接。')).toBeVisible();
 await p.goto(link);await expect(p.getByRole('heading',{name:'闭环测试候选人，您好'})).toBeVisible();await p.getByLabel('我已阅读测评规则',{exact:false}).check();await p.getByRole('button',{name:'同意并开始测评',exact:true}).click();const longAnswer='使用业务幂等键、唯一约束和事务保证订单只处理一次，并记录重试结果。'+Array.from({length:90},(_,i)=>String.fromCharCode(10)+'PRINT_LINE_'+String(i).padStart(3,'0')+'：通过唯一约束、事务、重试队列和监控处理失败，保持业务状态可追溯。').join('')+String.fromCharCode(10)+'PRINT_END_090';await p.getByLabel('第 1 题答案',{exact:true}).fill(longAnswer);await expect(p.getByText(/^已保存 ·/)).toBeVisible();await p.reload();await expect(p.getByLabel('第 1 题答案',{exact:true})).toHaveValue(/幂等键/);await p.getByRole('button',{name:'提交测评',exact:true}).click();await p.getByRole('button',{name:'确认提交',exact:true}).click();await expect(p.getByRole('heading',{name:'测评已提交',exact:true})).toBeVisible();
 await login(dept,'department');await dept.getByRole('button',{name:'测评与复核',exact:true}).click();await dept.getByRole('button',{name:'查看测评',exact:true}).click();const review=dept.getByRole('dialog');await expect(review.getByText(/使用业务幂等键/)).toBeVisible();await review.getByLabel('本题评分（1 最低，5 最高）').selectOption('4');await review.getByLabel('推进建议（仅内部可见）').selectOption('建议面试');await review.getByLabel('人工复核说明（仅内部可见）').fill('核心设计合理，建议面试时进一步核实故障恢复方案。 REVIEW_RECORD_END');await review.getByRole('button',{name:'保存我的人工复核',exact:true}).click();await expect(review.getByText('department测试账号 · 建议面试')).toBeVisible();
 await hr.getByRole('button',{name:'关闭弹窗'}).click();await hr.getByRole('button',{name:'测评与复核',exact:true}).click();await hr.getByRole('button',{name:'查看测评',exact:true}).click();dialog=hr.getByRole('dialog');await dialog.getByLabel('向候选人发布的反馈',{exact:false}).fill('感谢参与，您的业务设计表现良好，我们将安排下一轮面试。');await dialog.getByRole('button',{name:'发布反馈给候选人',exact:true}).click();await expect(dialog.getByRole('heading',{name:'已发布给候选人的反馈'})).toBeVisible();await hr.screenshot({path:testInfo.outputPath('hr-review-desktop.png'),fullPage:true});
 if (browserName === 'chromium') {
  await hr.emulateMedia({media:'print'});
  const pdf=await hr.pdf({path:testInfo.outputPath('long-answer.pdf'),format:'A4',printBackground:true});
  await hr.emulateMedia({media:'screen'});
  const loadingTask=getDocument({data:new Uint8Array(pdf),useSystemFonts:true,isEvalSupported:false});
  const document = await loadingTask.promise;
  let printed = '';
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    printed += (await page.getTextContent()).items.map(item => item.str).join(' ');
  }
  expect(document.numPages).toBeGreaterThan(1);
  for (let line = 0; line < 90; line++) {
    expect(printed).toContain('PRINT_LINE_' + String(line).padStart(3, '0'));
  }
  expect(printed).toContain('PRINT_END_090');
  expect(printed).toContain('RUBRIC_REFERENCE');
  expect(printed).toContain('REVIEW_RECORD_END');
  await loadingTask.destroy();
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(node=>node.matches(':modal'))).toBe(true);
 }
 await p.getByRole('button',{name:'刷新反馈',exact:true}).click();await expect(p.getByText('人工评分：80 / 100')).toBeVisible();await expect(p.getByText('核心设计合理，建议面试时进一步核实故障恢复方案。 REVIEW_RECORD_END')).toHaveCount(0);await p.setViewportSize({width:390,height:844});await p.screenshot({path:testInfo.outputPath('candidate-feedback-mobile.png'),fullPage:true});expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
 await hrContext.close();await candidateContext.close();await departmentContext.close();
});
test('管理员账号创建、首次改密及手机端登录布局',async({browser},testInfo)=>{
 const context=await browser.newContext(),page=await context.newPage();await login(page,'admin');await page.getByRole('button',{name:'设置与账号',exact:true}).click();await page.getByRole('button',{name:'创建账号',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('姓名',{exact:true}).fill('新同事测试账号');await dialog.getByLabel('工作邮箱',{exact:true}).fill('new-staff@example.test');await dialog.getByLabel('临时密码',{exact:false}).fill('New-only-password!2026');await dialog.getByRole('button',{name:'保存',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.getByText('new-staff@example.test',{exact:true})).toBeVisible();
 const creation = page.getByRole('row').filter({ hasText:'user.create' });
 const resourceId = await creation.locator('code').textContent();
 await page.getByLabel('资源编号', { exact:true }).fill(resourceId);
 await page.getByRole('button', { name:'查询审计' }).click();
 await expect(page.getByRole('row').filter({ hasText:resourceId })).toHaveCount(1);
 await page.getByLabel('资源编号', { exact:true }).fill('no-such-resource');
 await page.getByRole('button', { name:'查询审计' }).click();
 await expect(page.getByText('没有匹配的审计记录。')).toBeVisible();
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'退出工作区',exact:true}).click();await expect(page.getByRole('button',{name:'登录工作区',exact:true})).toBeVisible();
 const newcomer=await browser.newContext({viewport:{width:390,height:844}}),p=await newcomer.newPage();await p.goto('/');await p.getByLabel('工作邮箱',{exact:true}).fill('new-staff@example.test');await p.getByLabel('密码',{exact:true}).fill('New-only-password!2026');await p.getByRole('button',{name:'登录工作区',exact:true}).click();await expect(p.getByRole('heading',{name:'设置您的新密码'})).toBeVisible();await p.getByLabel('当前密码',{exact:true}).fill('New-only-password!2026');await p.getByLabel('新密码（至少 12 位）').fill('Changed-only-password!2026');await p.getByLabel('再次输入新密码').fill('Changed-only-password!2026');await p.getByRole('button',{name:'修改并重新登录',exact:true}).click();await expect(p.getByRole('heading',{name:'TalentDesk 招聘工作台'})).toBeVisible();await p.screenshot({path:testInfo.outputPath('login-mobile.png'),fullPage:true});expect(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await context.close();await newcomer.close();
});

function apiClient(request) {
  return { async call(route, method = 'GET', body) {
    const response = await request.fetch(route, { method, headers: { Origin: 'http://127.0.0.1:4173', 'X-Requested-With': 'TalentDesk' }, ...(body === undefined ? {} : { data: body }) });
    return { status: response.status(), body: await response.json() };
  } };
}

test('手机端开考前试答可重试且不计时、不写入正式答卷', async ({ request, page }) => {
  const hr = apiClient(request);
  expect((await hr.call('/api/auth/login', 'POST', { email: 'hr@example.test', password: 'E2e-only-password!2026' })).status).toBe(200);
  const business = await setupBusiness(hr);
  const link = await invite(hr, business);
  const headers = { 'X-Exam-Id': link.id };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(link.inviteUrl);
  await page.getByText('开考前试答（可选）', { exact: true }).press('Enter');
  const practice = page.getByLabel('试答文字', { exact: true });
  await expect(practice).toBeVisible();
  await expect(page.getByRole('button', { name: '检查发送' })).toBeDisabled();
  await page.route('**/api/portal/practice', route => route.abort(), { times: 1 });
  await practice.fill('这是一段测试文字');
  await practice.press('Enter');
  await expect(page.getByRole('alert')).toContainText('网络连接失败');
  await expect(practice).toHaveValue('这是一段测试文字');
  await practice.press('Enter');
  await expect(page.getByRole('status')).toHaveText('服务器已收到试答');
  await expect(page.getByRole('timer')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const before = await (await page.request.get('/api/portal/me', { headers })).json();
  expect(before).toMatchObject({ status: 'invited', startedAt: null, deadlineAt: null });
  expect(before).not.toHaveProperty('questions');

  await page.getByLabel('我已阅读测评规则', { exact: false }).check();
  await page.getByRole('button', { name: '同意并开始测评', exact: true }).click();
  await expect(page.getByLabel('第 1 题答案', { exact: true })).toHaveValue('');
  const after = await page.request.get('/api/portal/me', { headers });
  expect(await after.json()).toMatchObject({ status: 'in_progress', answers: {}, revision: 0 });
  const latePractice = await page.request.post('/api/portal/practice', {
    headers: { ...headers, Origin: 'http://127.0.0.1:4173', 'X-Requested-With': 'TalentDesk' },
    data: { answer: '开始计时后的试答' }
  });
  expect(latePractice.status()).toBe(409);
});

test('同浏览器双邀请：旧页保留并下载草稿，刷新仍绑定原考试', async ({ browser }) => {
  const staff = await browser.newContext(), shared = await browser.newContext();
  try {
    const hr = apiClient(staff.request);
    expect((await hr.call('/api/auth/login', 'POST', { email: 'hr@example.test', password: 'E2e-only-password!2026' })).status).toBe(200);
    const business = await setupBusiness(hr);
    const assessment = (await hr.call('/api/workspace')).body.assessments.find(a => a.id === business.assessmentId);
    expect((await hr.call('/api/assessments/' + assessment.id, 'PUT', { ...assessment, recordSwitch: false })).status).toBe(200);
    const aLink = await invite(hr, business);
    const created = await hr.call('/api/candidates', 'POST', { jobId: business.jobId, name: '双标签候选人 B', email: '', phone: '', resumeText: 'Node.js SQL', consent: true });
    const bLink = await invite(hr, { ...business, candidateId: created.body.id });
    const a = await shared.newPage(), b = await shared.newPage();
    const errors = []; for (const page of [a, b]) page.on('pageerror', e => errors.push(e.message));
    await a.goto(aLink.inviteUrl); await a.getByLabel('我已阅读测评规则', { exact: false }).check();
    await a.getByRole('button', { name: '同意并开始测评', exact: true }).click();
    await expect(a.getByLabel('第 1 题答案', { exact: true })).toBeVisible();
    await expect(a).toHaveURL(new RegExp('#/candidate/' + aLink.id + '$'));
    await b.goto(bLink.inviteUrl); await b.getByLabel('我已阅读测评规则', { exact: false }).check();
    await b.getByRole('button', { name: '同意并开始测评', exact: true }).click();
    await expect(b.getByLabel('第 1 题答案', { exact: true })).toBeVisible();
    const draft = 'A_TAB_DRAFT：仅属于 A 的本地未保存答案';
    await a.getByLabel('第 1 题答案', { exact: true }).fill(draft);
    await expect(a.getByRole('status')).toContainText('自动保存已暂停');
    await expect(a.getByLabel('第 1 题答案', { exact: true })).toHaveValue(draft);
    await expect(a.getByRole('button', { name: '提交测评', exact: true })).toBeDisabled();
    const downloadEvent = a.waitForEvent('download');
    await a.getByRole('button', { name: '下载本地答案副本', exact: true }).click();
    const download = await downloadEvent, chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString('utf8')).toContain(draft);
    await a.getByRole('button', { name: '退出', exact: true }).click();
    const me = await shared.request.get('/api/portal/me', { headers: { 'X-Exam-Id': bLink.id } });
    expect(me.status()).toBe(200);
    const current = await me.json(); expect(current.id).toBe(bLink.id); expect(current.revision).toBe(0); expect(current.answers).toEqual({});
    a.on('dialog', dialog => dialog.accept()); await a.reload();
    await expect(a.getByRole('alert')).toContainText('此浏览器已切换到另一份测评');
    await expect(a).toHaveURL(new RegExp('#/candidate/' + aLink.id + '$'));
    await expect(a.getByText('双标签候选人 B', { exact: false })).toHaveCount(0);
    await b.reload(); await expect(b.getByLabel('第 1 题答案', { exact: true })).toHaveValue('');
    await a.goto(aLink.inviteUrl); await expect(a.getByLabel('第 1 题答案', { exact: true })).toHaveValue('');
    await expect(a.getByRole('button', { name: '提交测评', exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
  } finally { await staff.close(); await shared.close(); }
});

test('岗位更新后的分析在列表与详情显示过期，重新分析后恢复当前状态', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage(); await login(page, 'hr'); const hr = apiClient(context.request);
    const business = await setupBusiness(hr);
    const candidate = (await hr.call('/api/candidates/' + business.candidateId)).body;
    expect((await hr.call('/api/candidates/' + candidate.id, 'PUT', { ...candidate, name: '过期分析专用候选人' })).status).toBe(200);
    const job = (await hr.call('/api/workspace')).body.jobs.find(j => j.id === business.jobId);
    expect((await hr.call('/api/jobs/' + job.id, 'PUT', { ...job, requirements: ['Python'] })).status).toBe(200);
    await page.getByRole('button', { name: '刷新工作区', exact: true }).click();
    await page.getByRole('navigation').getByRole('button', { name: /^候选人/ }).click();
    const row = page.getByRole('row').filter({ hasText: '过期分析专用候选人' });
    await expect(row.getByRole('cell', { name: /分析已过期/ })).toBeVisible();
    await row.getByRole('button', { name: '查看资料', exact: true }).click();
    const dialog = page.getByRole('dialog'); await expect(dialog.getByText(/岗位已更新，请重新分析/)).toBeVisible();
    await dialog.getByRole('button', { name: '重新分析关键词', exact: true }).click();
    await expect(dialog.getByText('岗位关键词覆盖（仅辅助筛选）：0%', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/岗位已更新，请重新分析/)).toHaveCount(0);
  } finally { await context.close(); }
});

test('保存失败后退出保留草稿，下载本地副本后可退出', async ({ browser }) => {
  const staff = await browser.newContext(), candidate = await browser.newContext();
  try {
    const hr = apiClient(staff.request);
    expect((await hr.call('/api/auth/login', 'POST', { email: 'hr@example.test', password: 'E2e-only-password!2026' })).status).toBe(200);
    const business = await setupBusiness(hr), link = await invite(hr, business), page = await candidate.newPage();
    await page.goto(link.inviteUrl); await page.getByLabel('我已阅读测评规则', { exact: false }).check();
    await page.getByRole('button', { name: '同意并开始测评', exact: true }).click();
    const saveRoute = '**/api/portal/answers';
    await page.route(saveRoute, route => route.abort());
    await page.getByLabel('第 1 题答案', { exact: true }).fill('恢复连接后保存的第一版');
    await expect(page.getByRole('status')).toContainText('尚未保存到服务器');
    await page.unroute(saveRoute);
    await page.getByRole('button', { name: '立即保存', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('已保存 ·');
    await page.reload();
    await expect(page.getByLabel('第 1 题答案', { exact: true })).toHaveValue('恢复连接后保存的第一版');
    await page.route(saveRoute, route => route.abort());
    const draft = 'NETWORK_DRAFT：断网时仍需保留的答案';
    await page.getByLabel('第 1 题答案', { exact: true }).fill(draft);
    await expect(page.getByRole('status')).toContainText('尚未保存到服务器');
    await page.getByRole('button', { name: '退出', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('请先下载本地答案副本');
    await expect(page.getByLabel('第 1 题答案', { exact: true })).toHaveValue(draft);
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载本地答案副本', exact: true }).click();
    const download = await downloadEvent, chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString('utf8')).toContain(draft);
    await page.getByRole('button', { name: '退出', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('已退出');
    const result = await hr.call('/api/exams/' + link.id);
    expect(result.body.status).toBe('in_progress');
  } finally { await staff.close(); await candidate.close(); }
});

test('我的待办与独立评审走通发布、只读结果和撤回', async ({ browser }) => {
  const contexts = await Promise.all([
    browser.newContext(), browser.newContext(), browser.newContext(),
    browser.newContext({ viewport: { width: 390, height: 844 } })
  ]);
  try {
    const [hr, reviewer, second, candidate] = await Promise.all(contexts.map(context => context.newPage()));
    await login(hr, 'hr');
    const business = await setupBusiness(apiClient(hr.request));
    const hrApi = apiClient(hr.request);
    const workspace = await hrApi.call('/api/workspace');
    const job = workspace.body.jobs.find(job => job.id === business.jobId);
    const renamed = await hrApi.call('/api/jobs/' + job.id, 'PUT', { ...job, title: '岗位默认评审试点' });
    expect(renamed.status).toBe(200);
    const response = await hrApi.call('/api/candidates/' + business.candidateId);
    expect(response.status).toBe(200);
    const changed = await hrApi.call('/api/candidates/' + business.candidateId, 'PUT', {
      ...response.body, name: '独立评审流程候选人'
    });
    expect(changed.status).toBe(200);
    await hr.getByRole('button', { name: '刷新工作区' }).click();
    await hr.getByRole('button', { name: '招聘岗位', exact: true }).click();
    await hr.locator('.card-grid > .panel').filter({ has: hr.getByRole('heading', { name: '岗位默认评审试点', exact: true }) })
      .getByRole('button', { name: '岗位评审默认安排' }).click();
    const policy = hr.getByRole('dialog', { name: '岗位评审默认安排' });
    await policy.getByLabel('为新邀请启用独立评审').check();
    await policy.getByLabel(/department测试账号/).check();
    await policy.getByLabel(/admin测试账号/).check();
    await policy.getByRole('button', { name: '保存', exact: true }).click();
    await expect(policy).not.toBeVisible();

    const link = await invite(hrApi, business);
    const openExams = page => page.getByRole('button', { name: '测评与复核', exact: true }).click();
    const examRow = page => page.getByRole('row').filter({ hasText: '独立评审流程候选人' });
    await hr.getByRole('button', { name: '刷新工作区' }).click();
    await openExams(hr);
    await examRow(hr).getByRole('button', { name: '查看测评' }).click();
    await expect(hr.getByText(/已提交 0 \/ 2 份/)).toBeVisible();
    await hr.getByRole('button', { name: '登记手动通知' }).click();
    await hr.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
    await hr.getByText('通知与调整记录').click();
    await expect(hr.getByText(/HR 已登记手动通知/)).toBeVisible();
    await hr.getByRole('button', { name: '调整作答时长' }).click();
    const durationDialog = hr.getByRole('dialog', { name: '调整作答时长' });
    await durationDialog.getByLabel('新时长（分钟）').fill('90');
    await durationDialog.getByLabel('调整原因').fill('开考前确认时长');
    await durationDialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(durationDialog).not.toBeVisible();

    await candidate.goto(link.inviteUrl);
    await expect(candidate.getByRole('heading', { name: '独立评审流程候选人，您好' })).toBeFocused();
    await expect(candidate.getByText('90', { exact: true })).toBeVisible();
    await candidate.getByText('作答需要帮助', { exact: true }).press('Enter');
    await expect(candidate.getByText(/如需额外作答时间/)).toBeVisible();
    await candidate.getByLabel('我已阅读测评规则', { exact: false }).press('Space');
    await candidate.getByRole('button', { name: '同意并开始测评' }).press('Enter');
    await expect(candidate.getByRole('heading', { name: '后端业务测评' })).toBeFocused();
    const answer = candidate.getByLabel('第 1 题答案');
    await answer.pressSequentially('synthetic keyboard answer');
    await expect(candidate.getByRole('status').filter({ hasText: /已保存/ })).toBeVisible();
    await candidate.reload();
    await expect(answer).toHaveValue('synthetic keyboard answer');
    await candidate.getByRole('button', { name: '提交测评', exact: true }).press('Enter');
    await candidate.getByRole('button', { name: '确认提交' }).press('Enter');
    await expect(candidate.getByRole('heading', { name: '测评已提交' })).toBeFocused();

    await login(reviewer, 'department');
    await login(second, 'admin');
    await openExams(reviewer);
    await openExams(second);
    const task = page => page.getByRole('row').filter({ hasText: '独立评审流程候选人' }).getByRole('button', { name: '填写复核' });
    const review = reviewer.getByRole('dialog');
    await task(reviewer).click();
    await review.getByLabel('本题评分（1 最低，5 最高）').selectOption('4');
    await review.getByLabel('人工复核说明（仅内部可见）').fill('部门内部评语');
    await review.getByLabel('复核保存方式').selectOption('submit');
    await review.getByRole('button', { name: '保存复核', exact: true }).click();
    await expect(review.getByText(/我的复核已提交/)).toBeVisible();

    await task(second).click();
    const secondReview = second.getByRole('dialog');
    await expect(secondReview.getByText(/已提交 1 \/ 2 份/)).toBeVisible();
    await expect(secondReview.getByText('部门内部评语')).toHaveCount(0);
    await secondReview.getByLabel('本题评分（1 最低，5 最高）').selectOption('4');
    await secondReview.getByLabel('人工复核说明（仅内部可见）').fill('管理员独立评语');
    await secondReview.getByLabel('复核保存方式').selectOption('submit');
    await secondReview.getByRole('button', { name: '保存复核', exact: true }).click();
    await expect(secondReview.getByText('部门内部评语')).toBeVisible();

    await hr.getByRole('button', { name: '关闭弹窗' }).click();
    await examRow(hr).getByRole('button', { name: '查看测评' }).click();
    const decision = hr.getByRole('dialog');
    await decision.getByLabel('决定理由', { exact: true }).fill('内部决定说明');
    await decision.getByLabel('关联答卷题目').selectOption(business.questionId);
    await decision.getByLabel('这份作答如何支持决定').fill('内部证据');
    await decision.getByLabel('向候选人发布的反馈').fill('感谢完成测评');
    await decision.getByRole('button', { name: '记录决定并发布反馈' }).click();
    await decision.getByRole('button', { name: '生成或补发只读结果链接' }).click();
    const resultLink = await decision.getByLabel('候选人只读结果链接').inputValue();
    await candidate.context().clearCookies();
    await candidate.goto(resultLink);
    await expect(candidate.getByRole('heading', { name: '测评反馈' })).toBeFocused();
    await expect(candidate.getByText('感谢完成测评')).toBeVisible();
    await expect(candidate.getByText('synthetic keyboard answer')).toHaveCount(0);
    await expect(candidate.getByText('内部决定说明')).toHaveCount(0);
    await expect(candidate).toHaveURL(/#\/result$/);
    await decision.getByRole('button', { name: '撤回反馈', exact: true }).click();
    await expect(decision.getByRole('heading', { name: '已发布给候选人的反馈' })).toHaveCount(0);
    await candidate.goto(resultLink);
    await expect(candidate.getByRole('alert')).toContainText('反馈链接已失效');

    await hr.getByRole('button', { name: '关闭弹窗' }).click();
    await hr.getByRole('button', { name: '招聘岗位', exact: true }).click();
    const jobCard = hr.locator('.card-grid > .panel').filter({
      has: hr.getByRole('heading', { name: '岗位默认评审试点', exact: true })
    });
    await jobCard.getByRole('button', { name: '导出试点记录' }).click();
    const download = hr.waitForEvent('download');
    await hr.getByRole('dialog').getByRole('button', { name: '下载 CSV', exact: true }).click();
    expect((await download).suggestedFilename()).toBe('pilot-review.csv');
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
