# 简历之后 · Beyond the Resume

为 TalentDesk 招聘工作台制作的 96 秒动态知识短片。1920 × 1080，16:9，8 幕，80 BPM。以简历纸张、任务答卷、证据连线、人工复核与反馈为视觉主线，沿用项目的森林绿与薄荷绿。

## 直接观看

双击项目根目录的 **简历之后.html**，或本目录的 **index.html**，在浏览器中点击“播放”。推荐使用近期的 Edge 或 Chrome，横屏或全屏观看。两个 HTML 的内容完全相同，各自都是单文件成品，可以独立复制到其他文件夹离线打开，不需要启动项目服务、安装依赖或访问网络。

- 播放、暂停、重播、拖动时间轴和章节跳转。
- 配乐与字幕独立开关，支持全屏。声音在第一次主动播放后启用。
- 空格播放/暂停；左右方向键跳转 5 秒；M 配乐；C 字幕；F 全屏；R 重播。
- 页面离开前台自动暂停；默认不自动播放。识别减少动态偏好，并提供完整文字解说。
- 可在 HTML 地址后使用 ?t=48，暂停定位至第 48 秒。

本版为**动态图形、屏幕字幕与原创程序配乐，没有人声旁白**。所有画面均为流程示意，不含真实候选人资料。

## 交付文件

| 文件 | 内容 |
| --- | --- |
| ../../简历之后.html | 项目根目录的便捷入口，独立离线播放 |
| index.html | 同一份单文件成品 |
| [after-the-resume.webm（Release 下载）](https://github.com/Nevergoodstudy/AIhrsuperworkstation/releases/download/v1.0.0/after-the-resume.webm) | 本机原文件名为简历之后.webm，通过浏览器录制的纯画面与配乐版本；具体编码及验证见 qa/playback.json、qa/video.json |
| poster.png | 1920 × 1080 封面 |
| contact-sheet.png | 8 幕画面总览 |
| final-script.md | 最终 32 句屏幕字幕及时间码 |
| subtitles.srt | 同步的 SRT 字幕，供后续剪辑使用 |
| storyboard.md | 内容子 agent 的分镜初稿，含拟议旁白，以最终字幕为准 |
| shell.html / player.js / scenes.js | 页面、播放器/字幕/配乐、8 幕动态图形源文件 |
| build.mjs | 将源文件打包为上述两个自包含 HTML |
| check.mjs | 浏览器控件、离线、配乐、跳转与响应布局检查 |
| record.mjs | 从 HTML 完整播放并录制 WebM 的制作脚本 |
| finalize-webm.mjs | 补入 WebM 时长元数据，保持原视频与音轨编码 |
| check-video.mjs | 独立解码 WebM，检查时长、音轨、播放和分段跳转 |
| qa/ | 测试结果、桌面/移动截图、逐幕画面与视觉复核记录 |

WebM 通过同一仓库的 Release 附件交付，方便使用浏览器观看或作为后续剪辑素材；它不是 MP4，也未作为抖音上传格式进行验收。HTML 是本次核心交付。如需运行视频校验脚本，将下载文件放回本目录并命名为简历之后.webm。

## 叙事与事实边界

8 幕依次为：简历与判断、经历与证据、观察的尺度、任务中作答、结论的出处、共同复核、业务的托付、简历之后。每幕 12 秒，每句字幕 3 秒。

文案结合项目 README.md、docs/acceptance.md 与 docs/operations.md 中记载的流程。可选 AI 用于整理原文线索，录用判断由人完成；不展示虚构的客户、业绩、效率提升或录用评分。权限、审计、备份与恢复以解释性图形呈现。成片末尾明确写出“正式环境待部署与业务验收”，不把功能示意当作正式环境已验收的证明。

## 风格研究与使用的 skill

研究日期：2026-11-15。根据“vibe 知识大赏”的公开检索结果，采用“问题开场 → 图形解释 → 逐句字幕 → 片尾提问”的叙事方法，以及深色留白、实物隐喻、分步显现与轻量转场。图形、文案与程序配乐为本项目新写，没有复制现成视频或音轨。

应用的 skill：

- 制作环境中的本地 frontend-design skill，用于视觉方向、排版、响应与最终检查；该技能不属于项目运行依赖。
- 公开 [vibe-knowledge](https://github.com/worlds3/vibe-knowledge/tree/main/skill/vibe-knowledge)：阅读其 SKILL.md 与 aesthetics、topics、engine、publishing 参考资料，用于确定性 Canvas、字幕节奏与动态知识片的制作方法。

公开检索来源：

- [抖音：干到最后为什么像抽卡](https://www.douyin.com/video/7631937026375159100)
- [抖音：text-to-html 动态内容制作说明](https://www.douyin.com/video/7639145802998803227)
- [vibe-knowledge 制作技能与参考资料](https://github.com/worlds3/vibe-knowledge/tree/main/skill/vibe-knowledge)

平台页面曾停留在视频加载状态，未完成对参考视频的完整播放。因此，本片参考的是公开检索信息与制作方法，不声称对上述视频做过逐帧复刻。

## 多 agent 协作

按用户要求，实际启动了两个独立 Codex 子进程：

1. 内容子 agent：梳理真实项目能力、制作分镜初稿、事实边界和发布介绍，产物为 storyboard.md。
2. 动画子 agent：制作 8 幕纯时间驱动 Canvas 图形，产物为 scenes.js。
3. 主 agent：定稿字幕与节奏、制作页面/播放系统/原创配乐、整合并修复转场透明度、处理开播提示位置、核对业务边界、浏览器视觉与交互检查，以及最终打包录制。

提示词与动画 agent 的完成说明保留在本目录的 agent-* 文件中，便于核查协作过程。agent-*.log 是本机过程日志，按仓库的忽略规则保留在本地，不上传到 GitHub。

## 本地复现

在项目根目录运行：

    node media/after-the-resume/build.mjs
    node media/after-the-resume/check.mjs
    node media/after-the-resume/record.mjs
    node media/after-the-resume/check-video.mjs

重新生成封面与八幕总览可运行 node media/after-the-resume/make-previews.mjs。WebM 已补入 96 秒时长元数据，浏览器无需完整扫描即可显示时长。

构建仅需 Node.js。检查与录制脚本使用项目已有的 @playwright/test 和本机 Edge；换电脑时可将脚本中的 channel 改为已安装的浏览器。无需运行这些脚本即可观看成品。

测试记录见 qa/result.json，整段播放与录制记录见 qa/playback.json，导出视频解码检查见 qa/video.json。配乐已验证生成非静音、无非有限数值、采样峰值未削波；这不等于完成了不同扬声器上的人工混音验收。浏览器 Canvas 的 CPU 命令提交时间也不代表端到端帧率，本项目不据此作性能承诺。

## 发布文案

《简历之后》：招聘判断，如何找到可以复核的依据？

简历提供经历线索，具体任务留下作答材料。96 秒，看 TalentDesk 如何串联岗位、测评、原文证据、人工复核与反馈。可选 AI 整理线索，重要判断由人完成。片中均为流程示意，正式环境仍待部署与业务验收。

建议话题：#vibe知识大赏 #招聘 #HR #TalentDesk #工作证据
