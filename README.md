# TalentDesk · 招聘工作台

[![业务流程验证](https://github.com/Nevergoodstudy/AIhrsuperworkstation/actions/workflows/ci.yml/badge.svg)](https://github.com/Nevergoodstudy/AIhrsuperworkstation/actions/workflows/ci.yml)
[![最新发布](https://img.shields.io/github/v/release/Nevergoodstudy/AIhrsuperworkstation)](https://github.com/Nevergoodstudy/AIhrsuperworkstation/releases/latest)

![TalentDesk 项目介绍：让招聘判断，有据可循](output/imagegen/talentdesk-roadshow-1920x1080-20261115.png)

面向单企业 HR 和用人部门的招聘应用，覆盖岗位、简历、测评邀请、候选人独立作答、人工复核和反馈发布。React 前端通过 Express API 访问 SQLite，简历原件保存在服务端私有目录。新环境从空库启动，没有默认账号、演示候选人或前端身份切换。

本版本采用单应用实例和本地持久化磁盘。已完成本机业务回归及远端 CI 的隔离容器重启、备份与新卷恢复验证；正式服务器、HTTPS、企业邮件和可选 AI 服务需要按 [验收清单](docs/acceptance.md) 完成部署验收，不能把自动化测试通过视为已经上线。

## 项目速览

**让招聘判断，有据可循。** AIhrsuperworkstation 是本项目的仓库名，TalentDesk 是应用名称。本仓库保存应用源码、自动化测试、部署配置、运维与验收文档，以及项目短片和路演素材。

- **招聘闭环**：岗位与筛选要求 → 简历与授权记录 → 专属测评邀请 → 候选人独立作答 → 人工复核 → 反馈发布。
- **角色协作**：管理员、HR、用人部门和候选人分别使用服务端校验的访问权限。
- **证据辅助**：关键词覆盖与原文定位；可选外部 AI 整理可核验线索，招聘决定由人完成。
- **运行交付**：提供 Docker / Caddy 部署配置、健康检查、数据备份与恢复脚本，以及正式环境验收清单。

技术栈：React 19、Vite 8、Node.js 24、Express 5、SQLite；浏览器测试使用 Playwright，持续集成使用 GitHub Actions。

## v2.0.0 · 候选人开考前试答（2026-11-23）

- 候选人可在正式开考前试答，确认试答文字能送达服务器。网络失败时保留输入，可在原页面重试。
- 试答属于可选步骤，不计分，不启动正式计时，也不写入正式答卷。
- 修复项目检出在隐藏目录下时，打开已构建的工作台首页返回 404 的问题。

查看 [GitHub Release](https://github.com/Nevergoodstudy/AIhrsuperworkstation/releases/tag/v2.0.0)、[发布说明](docs/releases/v2.0.0.md) 或 [完整变更记录](CHANGELOG.md)。

## v1.1.0 · 第一阶段改进（2026-11-17）

- 同浏览器多份邀请分别核对页面测评 ID 与授权会话，阻止旧标签页串写；冲突时保留草稿并提供下载副本。
- 测评事件遵循阶段归属规则，保留 HR 手动设置的面试、录用等决定，并在事务中记录阶段事件。
- AI 分析写回前重新校验账号会话及输入版本；旧分析明确标记过期，概述提示需要人工核验。
- 数据库自动迁移至 v4，新增阶段事件和分析运行记录；已覆盖真实旧版结构迁移与备份恢复回归。
- 增加隔离容器启动、重启持久化、原件、在线备份和新卷恢复验收，CI 上传检查报告。

完整说明见 [变更记录](CHANGELOG.md)、[发布说明](docs/releases/v1.1.0.md) 和 [第一阶段实施记录](docs/phase-one-results-2026-11-17.md)。升级前必须备份并校验，再在隔离副本验证迁移；回滚使用旧版本与兼容快照。单企业、单实例的运行范围不变。

## 文档与项目资料

| 入口 | 内容 |
| --- | --- |
| [本地启动](#本地启动) | 依赖安装、管理员创建与开发环境启动 |
| [运维手册](docs/operations.md) | HTTPS 部署、监控、定时备份、恢复、升级和回滚 |
| [交付验收记录](docs/acceptance.md) | 已验证范围、验证证据、能力边界和待验收事项 |
| [版本变更](CHANGELOG.md) / [v2.0.0 发布说明](docs/releases/v2.0.0.md) | 版本历史、改进内容、升级注意事项与验证结果 |
| [改进策略](docs/improvement-strategy-2026-11-16.md) / [第一阶段实施记录](docs/phase-one-results-2026-11-17.md) | 竞品研究、优先级、已落地修复及后续范围 |
| [容器与恢复验收](docs/phase-one-deployment.md) | 隔离容器检查、报告及正式部署剩余条件 |
| [简历之后 · 短片说明](media/after-the-resume/README.md) | 96 秒动态短片、分镜、字幕、播放器源文件和制作记录 |
| [离线短片 HTML](简历之后.html) / [WebM 视频（Release 下载）](https://github.com/Nevergoodstudy/AIhrsuperworkstation/releases/download/v1.0.0/after-the-resume.webm) | 下载后在浏览器中观看；GitHub 文件页不直接运行 HTML |
| [路演视觉素材](output/imagegen/README.md) | 原始图片、1920 × 1080 展示图、提示词和生成记录 |
| [核心功能 GIF](output/gifs/README.md) / [离线动图预览](output/gifs/index.html) | 真实界面配虚构资料：招聘流程总览、简历证据、候选人测评、人工复核与角色权限 |
| [持续集成](https://github.com/Nevergoodstudy/AIhrsuperworkstation/actions/workflows/ci.yml) | 依赖审计、业务测试、前端构建、浏览器测试、容器构建及重启备份恢复验收 |

## 源码目录

| 目录 / 文件 | 用途 |
| --- | --- |
| src/ | 工作台与候选人门户的 React 界面、API 客户端和样式 |
| server/ | Express API、SQLite 持久化、账号与会话、简历解析、邮件和可选 AI |
| tests/ | 业务、权限、解析、邮件、备份恢复与浏览器流程测试 |
| scripts/ | 数据备份、完整性校验、恢复工具与隔离容器验收 |
| deploy/、Dockerfile、compose.yaml | Caddy HTTPS 入口、应用镜像与持久化卷配置 |
| docs/ | 运维和交付验收资料 |
| media/、output/imagegen/、output/gifs/ | 项目短片、视觉素材、功能动图及其制作说明 |
| .github/workflows/ | GitHub Actions 自动化检查 |

较大的 WebM 成片作为 v1.0.0 Release 附件交付；播放器源码、离线 HTML、字幕、分镜和质检记录保存在仓库中。

仓库不包含依赖安装目录、构建缓存、真实环境配置、业务数据库、候选人原件、备份、运行日志和临时测试产物。首次克隆后按下文安装依赖并创建自己的管理员。

## 本地启动

需要 Node.js 24.x 和 npm，使用项目锁文件安装依赖：

首次获取项目：

~~~sh
git clone https://github.com/Nevergoodstudy/AIhrsuperworkstation.git
cd AIhrsuperworkstation
~~~

安装与启动：

```sh
npm ci
cp .env.example .env
npm run admin:create
npm run dev
```

在交互式终端创建管理员，密码输入不回显，临时密码为 12–128 位。首次登录必须改密。浏览器访问 **http://localhost:5173**；默认 API 为 127.0.0.1:3001，由 Vite 代理。页面访问地址必须与 APP_URL 一致，不要混用 localhost 与 127.0.0.1。

本机直接验证构建后的应用：

```sh
npm run build
APP_URL=http://localhost:3001 npm start
```

然后访问 http://localhost:3001。上述 HTTP 命令仅适用于本机开发验证；生产模式要求 APP_URL 为 HTTPS。

## 首次业务配置

1. 管理员在“设置与账号”创建 HR 和用人部门账号，安全交付临时密码。部门账号填写的部门名称必须与岗位所属部门精确一致。
2. HR 创建岗位与筛选要求，维护共享题库和逐题人工评分要点，建立岗位测评方案。
3. 获得候选人授权后导入简历或粘贴正文，核实姓名、联系方式、岗位及解析内容。原件以私有附件保存。
4. 创建候选人专属邀请。可手动分享链接，也可使用企业 SMTP 发送。链接仅在创建结果展示，数据库只存摘要；遗失后撤销原邀请并重新创建。
5. 候选人从独立邀请入口阅读规则、确认同意、开始限时测评。答案自动保存，界面显示保存状态，截止后仅提交服务端已收到的答案。
6. HR 或对应部门逐题人工评分并记录内部意见。HR 核查后发布候选人可见反馈，可撤回；已发布时锁定评分，需先撤回再修改。

邀请默认有效 7 天，可选 1–14 天。链接持有人在有效状态下可以再次进入，并非打开一次即失效；请把链接视为个人访问凭证，不要转发。恢复备份会清除会话，但不会自动撤销邀请。

## 访问权限

| 身份 | 业务范围 |
| --- | --- |
| 管理员 | 全部招聘业务、账号创建/停用/密码重置、最近 200 条审计记录 |
| HR | 全部岗位、候选人、简历原件、题库、测评、复核、反馈发布和 CSV 导出 |
| 用人部门 | 本部门岗位、候选人概况、已提交测评及人工复核；可读共享题库，不能维护岗位或题库、读取原件/完整简历/联系方式、导出或发布反馈 |
| 候选人 | 专属邀请对应的测评、自己的答案及 HR 已发布的反馈；不返回评分要点或内部评语 |

权限由每次服务端请求校验。部门答卷和证据中的邮箱、电话号码会做规则脱敏；规则无法识别所有个人信息，HR 仍需检查文本内容。共享题库供内部员工使用，不具备按部门隔离题目的功能。

## 业务能力与使用边界

- 简历：服务端解析 PDF、DOCX、UTF-8 TXT，每份不超过 10 MB；PDF 最多 100 页，DOCX 最多 2,000 个 ZIP 条目、解压总计 30 MB。独立 worker 限时 25 秒，最多并发两份。扫描件需要先转为可提取文字的文件，当前不含 OCR。
- 对照：关键词覆盖率直接对照岗位要求与原文，不是录用分。可选 AI 只整理可核验的原文证据，不替代人工决策；使用外部 AI 前需确认候选人授权与企业数据处理规则。
- 测评：服务端计时、答案保存版本控制、超时提交、邀请撤销、题目及评分要点快照。允许使用 AI 是测评规则及候选人声明，不表示系统提供答题 AI。切屏记录只是浏览器可见性事件，不是防作弊监考结论。
- 复核：逐题 1–5 分、内部建议、反馈发布/撤回、长答卷打印；展示的百分制结果来自人工评分。
- 数据：候选人删除会删除相关答卷、复核及私有原件；失败的文件清理由持久化队列重试。删除不会擦除此前备份，需配套备份保留策略。
- 邮件：区分未配置、未发送、发送服务已接受和失败。accepted 仅代表 SMTP 服务接受，不能证明到达收件箱；需核实退信、垃圾箱及服务商投递记录。
- 认证：密码摘要、首次改密、HttpOnly 会话 Cookie、写操作来源校验和限速、重置/停用后会话失效。HTTPS 下使用 Secure Cookie。没有 SSO/MFA、多企业租户或多实例高可用。

## 配置

配置文件为项目根目录 .env，修改后重启应用；不要把真实 .env、简历或备份提交到仓库。

| 变量 | 本地默认 / 用途 |
| --- | --- |
| NODE_ENV | development；正式部署为 production |
| APP_URL | http://localhost:5173；对外根地址，不能带路径、参数或凭证，生产必须 HTTPS |
| HOST / PORT | 127.0.0.1 / 3001；Compose 内使用 0.0.0.0 / 3001 |
| DATA_DIR | ./data；数据库和 resumes 私有原件目录，必须使用持久化存储 |
| COMPANY_NAME | 企业招聘工作区；邀请和工作区使用的企业名称 |
| TRUST_PROXY | 0；仅在受信任的单层反向代理后设为 1，Compose 已覆盖 |
| SITE_ADDRESS | Compose HTTPS 域名，不带协议；必须与 APP_URL 的域名一致 |
| TALENT_DATA_VOLUME | Compose 数据卷名，默认 talentdesk_talent_data |
| TALENT_BACKUP_VOLUME | Compose 备份卷名，默认 talentdesk_talent_backups |
| AI_BASE_URL | 默认 https://api.openai.com/v1，需 HTTPS、兼容 chat/completions 与 JSON 响应 |
| AI_API_KEY / AI_MODEL | 可选；均配置后启用外部 AI 证据分析 |
| SMTP_URL / MAIL_FROM | 可选；企业 SMTP 连接与发件人，凭证中的特殊字符需 URL 编码 |

SMTP 示例格式为 smtps://user:URL_ENCODED_PASSWORD@mail.example.com:465，或支持 STARTTLS 的 smtp://…:587。生产强制 TLS 并验证证书。未配置 AI 或邮件时，人工业务流程及手动分享邀请仍可使用。

## HTTPS 服务器部署

提供 Node.js 24 非 root 镜像、Caddy 入口、持久化卷、健康检查和独立备份任务。服务器需要 Docker Engine / Compose v2，域名已解析且 80、443 可达。**当前开发机没有 Docker，下列容器部署命令尚未在本机实跑。**

在服务器复制 .env.example 为 .env，填写 APP_URL=https://实际域名、SITE_ADDRESS=实际域名、公司名称及必要外部服务配置，限制 .env 权限后执行：

```sh
chmod 600 .env
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose exec app npm run admin:create
docker compose --profile tools run --rm --no-deps backup
```

对外只开放 Caddy 入口，应用端口不映射到主机。维护、监控、定时备份、升级回滚和恢复到新数据卷，见 [运维手册](docs/operations.md)。不要直接复制运行中的 SQLite 文件，也不要执行会删除数据卷的 docker compose down -v。

## 测试与备份

```sh
npm test
npm run build
npm audit --audit-level=high
npx playwright install chromium
npm run test:e2e
```

本机已有 Microsoft Edge 时，可用 PLAYWRIGHT_CHANNEL=msedge npm run test:e2e。测试使用隔离临时数据库，不初始化业务数据目录。CI 已配置上述检查及容器构建，只有实际运行成功才算 CI 验证通过。

v1.1.0 本机回归为服务端 **33/33**、Edge 浏览器 **5/5**，构建和依赖审计通过。[远端 Actions](https://github.com/Nevergoodstudy/AIhrsuperworkstation/actions/runs/44018184969) 同样全部通过，包含 Compose 配置、镜像构建和隔离容器重启、备份与新卷恢复；[容器 JSON 报告](docs/verification/v1.1.0-container-smoke.json) 已保存在仓库。Docker 环境可执行下列隔离验收；脚本只使用唯一命名的临时容器和卷，报告不替代真实域名、企业 SMTP / AI 与异地恢复验收。

~~~sh
docker build -t talentdesk:ci .
node scripts/container-smoke.mjs talentdesk:ci > container-smoke-report.json
~~~

```sh
npm run backup -- /绝对路径/备份根目录
npm run backup:verify -- /绝对路径/某次备份目录
# 恢复前停止服务；目标目录必须尚不存在。
node scripts/backup.mjs restore /绝对路径/某次备份目录 /绝对路径/全新数据目录
```

备份同时保存数据库快照与快照引用的原件，并校验文件大小、SHA-256、SQLite 完整性和外键。若复制时恰有原件被删除，备份会失败并清理本次目录，应低峰重试。管理员遗失密码可在同一配置环境的交互式终端执行 npm run admin:reset。

详细验证证据及尚未完成的正式环境验收，见 [交付验收记录](docs/acceptance.md)。
