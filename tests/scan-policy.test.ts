import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FORBIDDEN_URL_PARTS,
  isSensitiveEditableControl,
} from '../src/scan-policy';

test('登录页 URL 不再属于禁止扫描页面', () => {
  const loginUrl = 'https://login.aliexpress.com/user/seller/login';
  assert.equal(FORBIDDEN_URL_PARTS.some((part) => loginUrl.includes(part)), false);
});

test('验证码、风控和报告页仍禁止扫描', () => {
  for (const url of [
    'https://example.com/captcha/challenge',
    'https://example.com/verify',
    'https://example.com/risk/notice',
    'http://localhost:9323/playwright-report',
  ]) {
    assert.equal(FORBIDDEN_URL_PARTS.some((part) => url.includes(part)), true, url);
  }
});

test('登录页中的密码和验证码字段不采集', () => {
  assert.equal(
    isSensitiveEditableControl({ tag: 'input', type: 'password', attributes: [] }),
    true,
  );
  assert.equal(
    isSensitiveEditableControl({ tag: 'input', type: 'text', attributes: ['短信验证码'] }),
    true,
  );
  assert.equal(
    isSensitiveEditableControl({ tag: 'input', type: 'text', attributes: ['邮箱或手机号'] }),
    false,
  );
  assert.equal(
    isSensitiveEditableControl({ tag: 'button', type: '', attributes: ['登录'] }),
    false,
  );
});
