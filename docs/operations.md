# TalentDesk 运维手册

更新日期：2026-11-17。适用版本：v1.1.0；单企业、单应用实例、SQLite 和本地持久化磁盘。本文的容器命令是待服务器实测的交付步骤；当前开发机没有 Docker，不能以本文代替部署验收。测试结果及上线签收项目见 [验收记录](acceptance.md)，隔离自动化见 [容器与恢复验收](phase-one-deployment.md)。

## 1. 部署前准备

- 准备持续运行的服务器、Docker Engine / Compose v2、持久化磁盘和独立的备份存储。当前没有多实例协调或数据库高可用支持，不要扩容多个 app 实例或把 SQLite 放在网络共享盘上。
- 将域名解析到服务器，开放 Caddy 使用的 TCP 80、443；UDP 443 用于 HTTP/3。应用 3001 端口不对主机公开。不要在不受信的网络上直接暴露应用容器。
- 从项目根目录复制 .env.example 为 .env，设置 APP_URL=https://实际域名、SITE_ADDRESS=同一域名、COMPANY_NAME。APP_URL 必须是根地址，不能带路径、参数或凭证。
- 生产由 Compose 覆盖 NODE_ENV、HOST、PORT、DATA_DIR 和 TRUST_PROXY。TRUST_PROXY=1 仅适用于当前受信的单层 Caddy 代理；改变代理拓扑时重新验证来源 IP 与限速。
- 将 .env 权限设为 600；数据目录权限为 700，数据库为 600。只允许运维和应用身份接触数据卷、备份和企业 SMTP / AI 凭证。不要把简历、密码、邀请链接或真实配置放进仓库、截图或共享日志。
- SMTP 和外部 AI 均为可选项。没有配置时可通过人工复核和手动分享邀请开展业务。启用外部 AI 前，由企业确认候选人授权和数据传输范围。

在项目目录执行：

```sh
chmod 600 .env
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose exec app npm run admin:create
```

管理员创建需要交互式终端，密码输入不回显；安全交付临时密码，首次登录必须改密。没有默认账号。不要使用 docker compose config 的完整输出作为公开诊断材料，其中可能包含密钥。

启动后按 [正式环境清单](acceptance.md#正式环境上线签收) 验收。首次配置 HR、部门、岗位和题库时使用真实业务约定；部门名称按精确匹配授权。题库是内部共享的，不按部门隔离。

## 2. 日常检查与告警

```sh
docker compose ps
docker compose logs --since 30m --tail 200 app caddy
curl --fail --silent --show-error https://实际域名/api/health
curl --fail --silent --show-error https://实际域名/api/ready
```

health 表示进程可响应；ready 检查数据库能否执行 SELECT 1。二者都不验证磁盘可写、剩余空间、SMTP、AI 或完整业务链路。容器健康检查失败不会自动保证恢复业务；应对异常告警并排查。

至少监控：外部 HTTPS 可达性、证书、异常重启、5xx 错误、主机磁盘与 inode、数据卷与备份卷增长、最近一次成功备份时间及校验结果。另安排周期性的测试账号登录与业务抽查，频率由企业运营安排。避免把候选人正文、答案和邀请 token 发送到外部监控系统。

Compose 对 app 和 Caddy 的容器日志配置每份 10 MB、保留 3 份。主机定时任务日志、异地备份日志仍需自行轮转。管理界面仅展示最近 200 条审计；若企业有长期审计要求，应另行确定留存、授权和归档方式。当前未承诺 SLA、并发容量或恢复时限，需要结合实际使用量测量。

## 3. 备份、留存和异地保存

应用数据卷默认名为 talentdesk_talent_data，备份卷默认为 talentdesk_talent_backups；以 .env 中的实际配置为准。备份同时保存一致的 SQLite 在线快照和快照引用的简历原件，并校验大小、SHA-256、SQLite integrity_check 和外键。不要直接复制运行中的 talent.sqlite 文件作为备份。

```sh
docker compose --profile tools run --rm --no-deps backup
# SNAPSHOT 必须填写上一条命令输出的实际目录名。
SNAPSHOT='填写实际快照目录名'
docker compose --profile tools run --rm --no-deps backup verify "/backups/$SNAPSHOT"
```

备份任务使用只读数据卷和无网络容器。若备份过程中恰有简历原件被删除，本次任务会安全失败并清理本次目录，应低峰重试；不要把失败当作“没有变化”。命令非零退出必须告警。

以下是服务器 crontab 示例，假定项目位于 /srv/talentdesk，docker 实际路径为 /usr/bin/docker，主机具有 flock。安装前按实际路径调整，并手动运行一次验证权限、退出状态和日志。每天 02:15 只是示例，备份频率和留存期应按企业可接受的数据损失窗口及删除要求确定。

```cron
15 2 * * * cd /srv/talentdesk && /usr/bin/flock -n /run/lock/talentdesk-backup.lock /usr/bin/docker compose --profile tools run --rm --no-deps backup >> /var/log/talentdesk-backup.log 2>&1
```

调度器应能报告失败和长期未成功，不能仅检查日志文件是否存在。为 /var/log/talentdesk-backup.log 配置主机日志轮转，并定期检查锁冲突。当前工具不会自动删除旧快照：仅在新快照已验证且异地副本可用后，按已批准的留存策略清理指定旧快照，先核对目录名，禁止对数据卷执行通配删除。

同一主机上的备份卷只能防范部分误操作，不能覆盖主机或磁盘故障。应另行把完整快照（manifest.json、数据库、resumes 目录）加密保存到独立存储，限制访问并定期验证能解密、校验和恢复。备份包含个人信息、答卷和密码摘要；SHA-256 是完整性检查，不是加密或来源认证，只恢复受信来源的快照。

候选人删除不会擦除历史备份。记录删除请求及备份到期安排；从较早快照恢复后，在重新开放访问前重新应用尚在留存窗口内的删除请求。至少在首次上线和每次改变备份/存储方式后执行一次恢复演练，记录实际数据损失范围和恢复耗时。

## 4. 本地目录恢复

先停止使用该数据目录的全部应用进程。使用与快照兼容的应用版本和 Node.js 24，目标目录必须不存在；不要覆盖原目录。以下路径需替换为实际值：

```sh
npm run backup:verify -- /backup/实际快照目录
node scripts/backup.mjs restore /backup/实际快照目录 /srv/talentdesk/recovered-data-20261115
```

确认新目录属于实际运行应用的系统用户，目录 700、数据库 600。将 .env 的 DATA_DIR 改为新目录的绝对路径，使用原有服务管理方式启动。检查登录、岗位、候选人、原件下载、测评和反馈；通过后才恢复访问。原目录保留到演练/事件确认结束。

恢复会清除员工和候选人会话，所有人需重新登录或重新通过原邀请进入。邀请本身不会被自动撤销，快照后的撤销、改密和停用操作也可能回退；开放访问前核对这些变更，并按需要重新执行。

## 5. Docker 恢复到新卷

以下流程尚未在当前开发机执行。必须在服务器演练，使用新数据卷并保留旧卷；不能直接把卷根作为 restore 的目标，因为卷根已存在。先记录当前应用镜像/版本、旧数据卷名、备份卷名和已校验的快照名，确认备份中有需要的业务数据。

在项目目录先做当前备份（若故障允许），验证选定快照，再停止入口和应用：

```sh
docker compose --profile tools run --rm --no-deps backup
SNAPSHOT='填写已核实的实际快照目录名'
docker compose --profile tools run --rm --no-deps backup verify "/backups/$SNAPSHOT"
docker compose stop caddy app
```

下面的独立 shell 块需填写实际备份卷名和快照目录名，并选一个从未使用的新卷名。先确保 Docker daemon 可用，再检查卷不存在；任一步失败都应停止排查，不能把连接失败视为“卷不存在”。备份卷必须已经存在。

```sh
sh <<'SH'
set -eu
RESTORE_VOLUME=talentdesk_talent_data_restore_20261115
BACKUP_VOLUME=talentdesk_talent_backups
SNAPSHOT='填写已核实的实际快照目录名'
docker info >/dev/null
docker volume inspect "$BACKUP_VOLUME" >/dev/null
if docker volume inspect "$RESTORE_VOLUME" >/dev/null 2>&1; then
  printf '%s\n' '目标数据卷已存在，请选择全新卷名。' >&2
  exit 1
fi
docker volume create "$RESTORE_VOLUME" >/dev/null
docker run --rm --user 0:0 --network none --entrypoint sh \
  --mount "type=volume,source=$RESTORE_VOLUME,target=/restore" \
  --mount "type=volume,source=$BACKUP_VOLUME,target=/backups,readonly" \
  talentdesk:local -c '
    set -eu
    umask 077
    test -z "$(find /restore -mindepth 1 -maxdepth 1 -print -quit)"
    node scripts/backup.mjs restore "/backups/$1" /restore/recovered
    mv /restore/recovered/* /restore/
    rmdir /restore/recovered
    chown -R node:node /restore
    chmod 700 /restore /restore/resumes
    chmod 600 /restore/talent.sqlite
  ' sh "$SNAPSHOT"
printf '已恢复至新卷：%s\n' "$RESTORE_VOLUME"
SH
```

仅在恢复命令成功后，将 .env 的 TALENT_DATA_VOLUME 改为上述新卷名；保持 TALENT_BACKUP_VOLUME 指向原备份卷。确认当前 shell 没有同名旧环境变量覆盖 .env，然后执行：

```sh
docker compose config --quiet
docker compose up -d --no-build app caddy
docker compose ps
```

按上线清单复核业务，并重新执行快照后的删除、邀请撤销、账号停用/改密等必要操作。失败时先停止入口和应用、检查新卷及日志，不要删除旧卷；如需切回旧卷，使用与旧数据库兼容的应用版本，再切回原 TALENT_DATA_VOLUME。恢复验证结束前保留两个卷及选定快照。

## 6. 升级与回滚

新增独立评审和反馈链接的版本启动时自动应用 SQLite v5 迁移。旧答卷和已发布反馈沿用原工作流。HR 可在尚无历史复核的测评详情中启用独立评审，设置负责人、必要评审和期限。发布后经核实可补发 3 天有效的只读结果链接，补发会使旧结果链接失效。恢复快照会清除员工会话、候选人会话和只读结果链接，HR 可为当前已发布反馈重新签发。

### SQLite v6 与岗位评审试点

- HR 在招聘岗位中打开「岗位评审默认安排」，选择负责人、必要评审人和提交后的复核时限。每次新邀请保存当时的安排，正式提交或超时提交会开始计算复核期限。停用默认安排只影响之后的邀请。现有答卷需要改派时，在答卷详情单独调整。
- HR 在开考前可调整作答时长并记录原因。候选人页面提示确认更新后的时长。人工发出邀请后可在测评详情登记，候选人入口首次打开单独记录。已经发布的反馈记录首次成功返回时间，供核对试点中的反馈可达性。
- SMTP 明确拒收后可重试。连接中断等未取得明确响应的情况标为「发送结果未知」，HR 核实后可在保留原邀请链接的窗口中重试。发送中或已被 SMTP 接受的邀请会拒绝重复发送。应用重启时将未收尾的发送标为结果未知。手动通知和候选人打开入口分开记录。
- 在测评详情登记实际发生的催办、反馈发送和候选人确认。招聘岗位的「导出试点记录」按 UTC 提交日期筛选，包含测评编号、首次与当前承诺期限、首次决定、决定前的催办数和当前反馈的通知、访问及确认时间。表尾记录最近反馈撤回时间，可用于单列撤回样本。用试点约定的到期人口和观察窗口计算指标，外部催办和历史缺项通过人工记录补齐。
- SQLite v6 增加岗位评审安排、测评操作记录和反馈访问记录。升级前保存当前镜像和已校验快照。回滚时用旧镜像和升级前快照恢复到独立数据目录，核对答卷版本、评审分配与简历原件。恢复更早的快照后，开放访问前按企业记录重放删除、撤销和账号变更。

v1.0.0 → v1.1.0：使用 Node.js 24，按顺序停止业务写入、备份并校验、在隔离副本启动新版本验证，再升级正式实例。应用启动自动执行事务性 v4 迁移，新增阶段归属字段、阶段事件及分析运行表；不虚构旧阶段历史，不重写旧答案。历史无来源分析会显示需重新分析，应由 HR 再次核查。候选人门户旧标签页应从原邀请重新进入；自定义客户端必须在受保护门户请求中同时发送授权 Cookie 和 X-Exam-Id。CSV 新增“分析状态”列，依赖固定列序的外部工具需调整。新增字段不会提供向下迁移，回滚应使用 v1.0.0 与升级前快照恢复到新目录或新卷。

1. 记录正在使用的应用版本/镜像、配置和卷名，预留维护窗口；对当前数据做备份、校验并确认异地副本可用。不要只记录可被重建覆盖的 talentdesk:local 标签，应保留可识别的旧镜像/源代码版本。
2. 在隔离环境使用快照验证新版本和必要的数据迁移，再停止业务写入并部署正式版本。遵循项目锁文件安装依赖，执行与验收记录相同的检查。
3. 启动后检查 readiness、登录、上传/下载、候选人保存与提交、复核和反馈；在签收前保留旧镜像和备份。
4. 数据库结构若已迁移，不能假设旧代码可以直接读取新库。回滚应将兼容的代码与对应快照一起恢复到新卷，并说明备份之后写入的数据会受影响。重新开放前核对删除与权限变更。

不要执行 docker compose down -v；这会删除命名卷。日常停止/重启使用 stop、start 或 up，不删除数据卷。重新构建镜像不是备份。

## 7. 常见排错与交接

| 现象 | 检查与处理 |
| --- | --- |
| 登录或写入 403 / Cookie 未生效 | 页面域名、协议和 APP_URL 是否完全一致；避免 localhost 与 127.0.0.1 混用；HTTPS、受信代理和浏览器 Cookie 是否正常。不要以移除来源校验解决问题。 |
| 保存或复核返回 409 | 其他窗口或人员已修改版本；先保存必要草稿，刷新读取服务端最新状态，再人工合并。不要自动覆盖。 |
| 自动保存失败或超时 | 检查页面保存状态和网络；截止后只提交服务端已经收到的答案，本地未保存文本不能追溯视为准时提交。 |
| 简历解析失败 | 核对文件类型/10 MB 限制、PDF 页数、DOCX 解压限制和文本是否可提取。扫描件先转换；检查 worker 超时或并发繁忙提示，避免反复导入同一简历。 |
| 邮件 failed / accepted 但收不到 | 核对企业 SMTP TLS、证书、URL 编码凭证和 MAIL_FROM；检查退信、垃圾箱及服务商投递记录。accepted 仅代表服务端接受，不能证明收件箱送达。可重新创建邀请后人工分享。 |
| HTTPS 证书失败 | 核对 DNS、80/443、防火墙、SITE_ADDRESS、Caddy 日志与证书卷；不要清空证书卷或关闭证书验证来掩盖原因。 |
| 管理员遗失密码 | 在可信交互终端运行 docker compose exec app npm run admin:reset（本地则 npm run admin:reset），输入不回显；会撤销该账号会话，首次登录需改密。 |
| 数据删除后磁盘未立即回收 | 检查应用错误及原件清理重试；历史备份仍受保留策略约束。不要直接删数据库、卷或整棵 resumes 目录。 |

交接时明确业务负责人、系统维护人、备份/恢复负责人和凭证保管方式，实际演示一次完整招聘流程和一次恢复。本文不构成法律合规保证；数据告知、保存期限、访问授权及是否向外部 AI 发送内容由企业按业务要求确认。
