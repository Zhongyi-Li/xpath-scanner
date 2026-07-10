import { chromium, type Browser } from 'playwright';

export const LOCAL_CHROME_CDP_ENDPOINT = 'http://127.0.0.1:9222';

export const LOCAL_CHROME_START_COMMAND = String.raw`/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/chrome-playwright-profile"`;

function isConnectionRefusedMessage(message: string): boolean {
  return /ECONNREFUSED|connect ECONNREFUSED|retrieving websocket url/i.test(message);
}

export function formatChromeCdpConnectionError(endpoint: string, originalMessage: string): string {
  return [
    `无法连接到本地 Chrome CDP: ${endpoint}`,
    '',
    '请用下面的专用 Chrome 命令重新启动浏览器（不要复用已打开的普通 Chrome 窗口）：',
    LOCAL_CHROME_START_COMMAND,
    '',
    '启动后请在这个 Chrome 里手动登录网站，再运行 pnpm scan。',
    `你也可以先执行 curl ${endpoint}/json/version 检查 9222 端口是否真的在监听。`,
    '',
    `原始错误: ${originalMessage}`,
  ].join('\n');
}

export async function connectToLocalChrome(): Promise<Browser> {
  try {
    return await chromium.connectOverCDP(LOCAL_CHROME_CDP_ENDPOINT);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isConnectionRefusedMessage(message)) {
      throw new Error(formatChromeCdpConnectionError(LOCAL_CHROME_CDP_ENDPOINT, message));
    }
    throw error;
  }
}
