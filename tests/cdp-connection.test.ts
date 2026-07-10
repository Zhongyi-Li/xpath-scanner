import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatChromeCdpConnectionError,
  LOCAL_CHROME_CDP_ENDPOINT,
  LOCAL_CHROME_START_COMMAND,
} from '../src/cdp-connection';

test('CDP 连接失败提示包含专用 Chrome 启动命令和端口检查方式', () => {
  const message = formatChromeCdpConnectionError(LOCAL_CHROME_CDP_ENDPOINT, 'connect ECONNREFUSED');

  assert.match(message, /127\.0\.0\.1:9222/);
  assert.match(message, /--remote-debugging-port=9222/);
  assert.match(message, /--user-data-dir="\$HOME\/chrome-playwright-profile"/);
  assert.match(message, /curl http:\/\/127\.0\.0\.1:9222\/json\/version/);
  assert.ok(message.includes(LOCAL_CHROME_START_COMMAND));
});
