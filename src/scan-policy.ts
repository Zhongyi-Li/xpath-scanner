export const FORBIDDEN_URL_PARTS = [
  'captcha',
  'verify',
  'risk',
  'localhost:9323',
  'playwright-report',
  'about:blank',
  'chrome://',
];

export const SENSITIVE_FIELD_PATTERN_SOURCE =
  'password|passwd|pwd|验证码|校验码|动态码|sms[-_ ]*code|verification[-_ ]*code|auth[-_ ]*code|one[-_ ]*time[-_ ]*code|otp|token|cookie';

export function isSensitiveEditableControl(input: {
  tag: string;
  type: string;
  attributes: string[];
}): boolean {
  const tag = input.tag.trim().toLowerCase();
  if (!['input', 'textarea'].includes(tag)) return false;
  if (input.type.trim().toLowerCase() === 'password') return true;

  const sensitivePattern = new RegExp(SENSITIVE_FIELD_PATTERN_SOURCE, 'i');
  return sensitivePattern.test(input.attributes.join(' '));
}
