# Copilot 项目级规则（XPath 扫描）

本文件只定义 Copilot 的行为边界，不重复写操作细节。

规则分层：
- 项目级硬规矩：AGENTS.md
- 专项执行手册：skills/xpath-scan/SKILL.md

Copilot 在本仓库进行任何修改前，必须先遵守：
1. AGENTS.md
2. skills/xpath-scan/SKILL.md

当两者有冲突时，以 AGENTS.md 为准；实现细节以 SKILL.md 为准。

---

## Copilot 必须做到

1. 仅围绕 XPath 扫描任务修改代码。
2. 保持最终 Excel 固定格式（7 列 + XPath清单）。
3. 默认保持交互式模式（scan/url/pages/help/exit）。
4. 优先保证可中断、可恢复、可实时落盘。
5. 明确区分最终结果文件与中间状态文件。

## Copilot 严禁行为

1. 自动登录淘宝/千牛。
2. 自动输入密码、验证码或绕过风控。
3. 保存 Cookie、Token、LocalStorage、SessionStorage。
4. 自动点击风险按钮（提交、删除、发货、退款等）。
5. 编造未实际进入页面的元素或 XPath。
6. 擅自改动 Excel 列结构、Sheet 名称、平台字段规则。

## Copilot 输出要求

1. 代码修改说明要简明、可执行。
2. 运行命令应可直接复制。
3. 若扫描失败，先给出可操作排查步骤，不输出臆测结果。
