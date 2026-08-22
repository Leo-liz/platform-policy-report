# Platform Policy Report

这是“平台政策抓取”项目的 Vercel/GitHub Pages 发布仓库。公开区域只包含已经通过本地验收的 HTML 日报、历史索引和不含人员信息的平台/标签目录。

固定入口：

- `reports/latest.html`
- `reports/latest/`

私有管理入口：

- `admin/notifications/`

该入口通过服务端管理员会话访问 Neon 中的人员、订阅规则和发送审计。GitHub Pages 仍只承担只读报告镜像，不提供配置 API。

## 首次配置

1. 在 Vercel Marketplace 连接 Neon，并将 `DATABASE_URL` 设为私有环境变量。
2. 按 `.env.example` 配置管理员会话、heartbeat 调度令牌及钉钉内部应用变量。
3. 运行 `npm run migrate` 初始化数据库结构。
4. 先只设置 `DINGTALK_TEST_USER_ID`，从管理页完成一次真实测试通知；确认 task_id 和发送结果后，才把 `DINGTALK_PRODUCTION_SEND_ENABLED` 改为 `true`。

本仓库不包含抓取代码、原始快照、证据正文、数据库内容、人员标识、私有配置或访问令牌。`reports/notification-catalog.json` 只含公开的平台和主标签枚举。

## Vercel Git 集成

现有 Vercel 项目 `site` 只连接本仓库：功能分支用于 Preview 验收，只有合入 `main` 后才允许更新生产环境。
