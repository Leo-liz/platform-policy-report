# Platform Policy Report

这是“平台政策抓取”项目的 Vercel/GitHub Pages 发布仓库。公开区域只包含已经通过本地验收的 HTML 日报、历史索引和不含人员信息的平台/标签目录。

固定入口：

- `reports/latest.html`
- `reports/latest/`

私有管理入口：

- 本机双击 `启动本机通知配置.cmd`
- 浏览器打开 `http://localhost:4317/admin/notifications`

该入口仅监听本机回环地址，通过服务端管理员会话和独立的最小权限数据库账号访问 Neon 中的人员、订阅规则和发送审计。本机私有配置写入被 Git 忽略的 `.env.admin.local`，不进入仓库。GitHub Pages 仍只承担只读报告镜像，不提供配置 API；`*.vercel.app` 继续作为云端通知后台，不再作为国内用户入口。

## 本机管理页

1. 双击 `启动本机通知配置.cmd`，保持弹出的命令窗口运行。
2. 启动器读取 `.env.admin.local` 中的本机管理员哈希、会话密钥和独立 Neon 连接；该文件被 Git 忽略。
3. 浏览器打开 `http://localhost:4317/admin/notifications`，使用既有管理员密码登录。
4. 完成配置后在命令窗口按 `Ctrl+C` 停止服务。

管理服务固定绑定 `127.0.0.1`，同事及局域网设备无法访问。本机模式不复制钉钉 AppSecret，也不提供真实测试发送；姓名搜索调用本机已登录的 `dws aisearch person`，只向页面返回显示名和 userId，失败时仍可手工填写。正式每日通知仍由 Vercel 云端调度执行。

公开日报导航栏包含“通知配置（仅本机）”入口。该按钮只跳转到本机回环地址，不会把管理页面、人员信息或凭证发布到 GitHub Pages；使用前仍需双击启动器并保持窗口运行。

本机数据库账号固定为 `platform_policy_local_admin_v2`：只允许维护收件人、规则、登录限流和操作审计，只读发送记录，不能修改发送结果或创建数据库结构。可运行 `npm run verify-local-admin` 随时复核权限边界。

## 首次配置

1. 在 Vercel Marketplace 连接 Neon，并将 `DATABASE_URL` 设为私有环境变量。
2. 按 `.env.example` 配置管理员会话、heartbeat 调度令牌及钉钉内部应用变量。
3. 运行 `npm run migrate` 初始化数据库结构。
4. 先只设置 `DINGTALK_TEST_USER_ID`，运行 `npm run seed-test-recipient` 或在管理页点击“初始化测试订阅”，创建测试收件人及“全部平台 × 全部主标签”初始规则；再完成一次真实测试通知。确认 task_id 和发送结果后，才把 `DINGTALK_PRODUCTION_SEND_ENABLED` 改为 `true`。

如不希望把私有环境变量拉到本机，可仅在一次 Preview 部署中传入构建变量 `SEED_TEST_SUBSCRIPTION_ON_BUILD=true`。它只在该次 Vercel 构建内完成幂等初始化，不会持久保存该开关；普通后续构建不会重新启用已被管理员停用的订阅。

通讯录姓名搜索要求 `DINGTALK_DIRECTORY_DEPARTMENT_IDS` 中的每个部门都位于该内部应用的通讯录可见范围内。权限名称已开通但可见范围未覆盖部门时，钉钉会拒绝读取；管理页会明确提示，并继续允许手工填写显示名和 userId。

本仓库不包含抓取代码、原始快照、证据正文、数据库内容、人员标识、私有配置或访问令牌。`reports/notification-catalog.json` 只含公开的平台和主标签枚举。

## Vercel Git 集成

现有 Vercel 项目 `site` 只连接本仓库：功能分支用于 Preview 验收，只有合入 `main` 后才允许更新生产环境。
