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
4. 先只设置 `DINGTALK_TEST_USER_ID`，运行 `npm run seed-test-recipient` 或在管理页点击“初始化测试订阅”，创建测试收件人及“全部平台 × 全部主标签”初始规则；再完成一次真实测试通知。确认 task_id 和发送结果后，才把 `DINGTALK_PRODUCTION_SEND_ENABLED` 改为 `true`。

通讯录姓名搜索要求 `DINGTALK_DIRECTORY_DEPARTMENT_IDS` 中的每个部门都位于该内部应用的通讯录可见范围内。权限名称已开通但可见范围未覆盖部门时，钉钉会拒绝读取；管理页会明确提示，并继续允许手工填写显示名和 userId。

本仓库不包含抓取代码、原始快照、证据正文、数据库内容、人员标识、私有配置或访问令牌。`reports/notification-catalog.json` 只含公开的平台和主标签枚举。

## Vercel Git 集成

现有 Vercel 项目 `site` 只连接本仓库：功能分支用于 Preview 验收，只有合入 `main` 后才允许更新生产环境。
