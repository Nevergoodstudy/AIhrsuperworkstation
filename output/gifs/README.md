# TalentDesk · 功能 GIF

在浏览器打开 [离线预览页](index.html)，按需播放或保存。所有 GIF 无限循环，无音轨。

| 文件 | 内容 | 时长 | 尺寸 | 大小 |
| --- | --- | --- | --- | --- |
| [talentdesk-overview.gif](talentdesk-overview.gif) | 核心功能总览 | 27.66 秒 | 1280 × 900 | 4.09 MiB |
| [talentdesk-overview-compact.gif](talentdesk-overview-compact.gif) | 核心功能总览 · 轻量版 | 27.63 秒 | 960 × 675 | 2.06 MiB |
| [01-resume-evidence.gif](01-resume-evidence.gif) | 岗位与简历原文证据 | 10.50 秒 | 1280 × 900 | 1.52 MiB |
| [02-candidate-assessment.gif](02-candidate-assessment.gif) | 候选人测评与自动保存 | 15.00 秒 | 1280 × 900 | 1.37 MiB |
| [03-human-review-feedback.gif](03-human-review-feedback.gif) | 人工复核与反馈发布 | 10.50 秒 | 1280 × 900 | 1.09 MiB |
| [04-roles-privacy.gif](04-roles-privacy.gif) | 角色权限与操作审计 | 11.75 秒 | 1280 × 900 | 1.50 MiB |

## 画面与内容

采用真实应用关键状态截图，叠加标题、解释字幕、光标运动、重点框和转场；展示节奏经过剪辑，并非未经剪辑的连续屏幕录制。沿用项目森林绿、薄荷绿和米白的视觉风格。

全部资料、账号、答卷和评分均为虚构演示；使用隔离临时数据库，未调用外部 AI 或发送邮件。PNG 封面便于静态展示；离线预览支持停止播放并返回封面，默认不自动播放。

## 已验证

- 简历关键词覆盖 75%，同时显示原文证据和未命中项；覆盖率不是录用分。
- 候选人答案自动保存成功，刷新后完整答案与保存前一致。
- 部门复核人逐题评分 4/5；HR 发布后候选人可见人工评分 80/100 和公开反馈，内部评语不可见。
- 技术部列表不含产品部候选人；部门详情接口不返回联系方式或完整简历；原件接口返回 403。
- 上述真实浏览器流程无页面脚本错误。
- Pillow 解码全部 GIF 帧，确认尺寸、实际时长、无限循环及持续帧变化，详见 [检查记录](qa-report.json)。
- 已抽查各功能代表帧，检查字幕、截图布局与重点框。制作信息及流程断言见 [manifest.json](manifest.json)。

系统不会自动作出录用或淘汰决定；可选 AI 仅整理证据。本机演示不代表正式环境已经通过服务器、HTTPS、邮件和相关服务的部署验收。

## 复现

源文件和运行方法见 [media/feature-gifs](../../media/feature-gifs/README.md)。无需修改业务代码或使用真实数据库。
