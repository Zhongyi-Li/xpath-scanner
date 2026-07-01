# AGENTS.md

本文件是项目级硬规矩（人和 AI 都必须遵守）。
扫描实现细节统一见 skills/xpath-scan/SKILL.md。

---

## 1. 项目目标

1. 连接本地真实 Chrome（CDP）。
2. 扫描当前页面可点击元素并生成稳定 XPath。
3. 写入 xpath-result.xlsx，并维护可恢复状态。

## 2. 浏览器与登录约束

1. 必须使用用户手动启动并已登录的本地 Chrome。
2. 必须通过 chromium.connectOverCDP 连接。
3. 禁止自动登录、自动输入验证码、绕过风控。
4. 禁止扫描登录页、验证码页、风控页、Playwright 报告页。

## 3. 交付格式硬约束

1. 最终文件：xpath-result.xlsx。
2. Sheet：XPath清单。
3. 列固定且仅 7 列：
   - 页面路径
   - 元素名称
   - 元素类型
   - 定位方式
   - 平台
   - 成功标志
   - 适用流程
4. 平台固定为：天猫。
5. 不允许新增列，不允许新增 Sheet。

## 4. 中间文件与落盘

1. 必须维护：xpath-rows.json、xpath-progress.json。
2. 调试信息仅允许写入 xpath-debug.log。
3. 每次 scan 完成后必须实时落盘。
4. 若 Excel 写入失败，至少保证 JSON 数据已保存。

## 5. 执行模式

1. 默认交互式扫描，不自动全站导航。
2. 脚本必须支持：scan / url / pages / help / exit。
3. 用户手动切页，脚本仅在用户输入 scan 后执行。

## 6. 风险与安全

1. 风险按钮只记录 XPath，不自动点击。
2. 禁止保存任何敏感信息：密码、验证码、Cookie、Token、隐私数据。
3. 元素名称和 XPath 不得包含动态敏感变量。

## 7. 去重与恢复

1. 唯一键：页面路径 / 元素名称 / 元素类型 / 适用流程。
2. 已存在且 XPath 一致：跳过。
3. 已存在但 XPath 更稳定：更新。
4. 默认不从头重跑，不删除历史，除非用户明确要求。

## 8. 验收标准

1. 可通过 pnpm scan 启动。
2. 可连接本地 Chrome。
3. 支持 scan/url/pages/help/exit。
4. Excel 满足固定 7 列与 Sheet 要求。
5. 支持中断恢复和去重。
6. 未触发禁止行为。
