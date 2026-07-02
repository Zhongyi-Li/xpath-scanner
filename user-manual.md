# XPath 扫描工具（极简版）

这份文档只讲两件事：
1. 先做什么
2. 输入什么命令

---

## 一次扫描的最短流程

### 1) 启动 Chrome（必须先做）

在终端 A 输入：

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  # XPath 扫描工具极简使用说明

  只看这一页就够了。

  ## 一次性准备

  1. 打开终端，进入项目目录

  cd xpath-scanner

  2. 安装依赖

  pnpm install

  ## 每次开始工作

  1. 先启动专用 Chrome（终端 A）

  /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
    --remote-debugging-port=9222 \
    --user-data-dir="$HOME/chrome-playwright-profile"

  2. 在这个 Chrome 里手动登录千牛/淘宝商家后台

  3. 再开一个终端（终端 B），启动扫描脚本

  cd xpath-scanner
  pnpm scan

  ## 扫描时你只需要记住 2 个命令

  在看到提示符 xpath-scan> 后，循环执行：

  1. 先输入

  url

  用途：确认当前页面是不是你要扫的页面。

  2. 再输入

  scan

  用途：扫描当前页面并写入结果文件。

  3. 手动切换下一个页面后，重复上面两步。

  ## 其他可用命令

  pages   查看当前 Chrome 打开的页面列表
  help    查看命令说明
  exit    退出扫描脚本

  ## 遗漏页面补扫

  如果运营反馈漏了某个页面，可以只导出该页面，不影响已有结果和进度：

  1. 在 Chrome 中手动打开并激活遗漏页面。
  2. 在扫描脚本中确认当前页面：

  url

  3. 输入独立补扫命令：

  rescan --漏扫页面.xlsx

  新文件会生成在项目根目录，只包含当前激活页面的 XPath。命令不会读取或修改 `xpath-result.xlsx`、`xpath-rows.json`、`xpath-progress.json`。

  文件名必须以 `.xlsx` 结尾，不能包含目录。若文件已存在，脚本会拒绝覆盖，请换一个文件名后重试。

  ## 结果文件在哪里

  每次 scan 后会更新以下文件：

  - xpath-result.xlsx（最终交付）
  - xpath-rows.json（完整数据，断点恢复用）
  - xpath-progress.json（进度检查点）

  ## 常见报错怎么处理

  1. 报错连接失败 ECONNREFUSED 127.0.0.1:9222
  - 说明 Chrome 没按上面的命令启动。
  - 重新执行“启动专用 Chrome”的命令。

  2. 扫到登录页/验证码页
  - 不要 scan。
  - 先手动完成登录或验证，再执行 url -> scan。

  3. 误输入 pnpm url
  - 这是错的。
  - 正确做法是先执行 pnpm scan，再在脚本里输入 url。

  ## 一句话流程

  先开 Chrome并登录 -> 再跑 pnpm scan -> 每页执行 url -> scan -> 切下一页继续。
