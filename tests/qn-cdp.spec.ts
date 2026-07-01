import { test } from '@playwright/test';
import { chromium } from 'playwright';

test('connect local chrome and scan qn page', async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');

  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();

  const targetUrl =
    'https://qn.taobao.com/home.htm/comment-manage/list/rateWait4PC?current=1&pageSize=20';

  await page.goto(targetUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  console.log('Current URL:', page.url());
  console.log('Title:', await page.title());

  await page.waitForTimeout(5000);

  const elements = await page.locator('button, a, input, textarea, select, [role="button"], [role="combobox"], [role="tab"]').evaluateAll((els) =>
    els.map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim(),
      placeholder: el.getAttribute('placeholder'),
      ariaLabel: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      id: el.id,
      className: el.className,
    }))
  );

  console.log(JSON.stringify(elements, null, 2));

  await browser.close();
});