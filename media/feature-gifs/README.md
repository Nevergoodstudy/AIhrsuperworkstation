# TalentDesk 功能动图制作

成片、封面与离线预览位于 [output/gifs](../../output/gifs/README.md)。

## 制作方式

- generate.mjs 启动隔离临时数据库，显式禁用 SMTP 与外部 AI。通过真实 API 建立虚构岗位、候选人与账号，用 Playwright 操作构建后的应用。
- 真实执行邀请、规则确认、自动保存、刷新恢复、提交、部门人工复核与 HR 反馈发布，并验证部门访问边界及候选人不可见内部评语。
- renderer.mjs 将关键状态截图绘制到 Canvas，加入中文说明、光标、重点框与转场。画面时序经过剪辑，不是未经剪辑的屏幕录制。
- FFmpeg 采用两遍调色板编码为无限循环 GIF；另输出一份轻量总览。verify.py 解码每帧并检查尺寸、循环、时长与帧变化。
- 演示数据库与中间视频保存在系统临时目录，生成结束后清理；不会操作现有业务库、发送邮件或把邀请凭证写入成片。

## 运行

需要项目规定的 Node.js 24、已安装的项目依赖、Python 3 + Pillow，以及 FFmpeg。默认使用 Microsoft Edge 无头浏览器；可通过 PLAYWRIGHT_CHANNEL 改为已安装的 Playwright 浏览器通道。

从项目根目录执行：

~~~sh
npm run build
FFMPEG_BIN=/absolute/path/to/ffmpeg node media/feature-gifs/generate.mjs
python3 media/feature-gifs/verify.py
~~~

FFmpeg 已在 PATH 时可省略 FFMPEG_BIN。运行会覆盖 output/gifs 中同名成片与封面。Pillow 可安装在项目外的 Python 虚拟环境；不需要修改项目依赖文件。成片变化后应同步交付目录的预览页与说明。

## 交付约定

原尺寸为 1280 × 900、12 fps；轻量总览为 960 × 675、8 fps。GIF 延时以百分之一秒计，单帧时长会量化；文件说明采用实际解码累计时长。所有业务数字、账号和评分均标为虚构演示，不用于支持效率、客户或生产部署声明。
