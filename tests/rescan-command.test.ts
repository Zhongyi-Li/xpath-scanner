import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseInteractiveCommand,
  resolveRescanOutputName,
  resolveRescanOutputPath,
} from '../src/rescan-command';

test('解析 rescan 时保留原始文件名参数', () => {
  assert.deepEqual(parseInteractiveCommand('rescan --漏扫页面.xlsx'), {
    command: 'rescan',
    argument: '--漏扫页面.xlsx',
  });
});

test('补扫文件名保留大小写', () => {
  assert.equal(
    resolveRescanOutputName('--CampaignPage.XLSX'),
    'CampaignPage.XLSX',
  );
});

test('拒绝格式错误或不安全的补扫文件名', () => {
  const invalidArguments = [
    '',
    '--.xlsx',
    '--漏扫页面.csv',
    '--漏扫页面.xlsx 其他参数',
    '--../漏扫页面.xlsx',
    '--folder/漏扫页面.xlsx',
    '--folder\\漏扫页面.xlsx',
  ];

  for (const argument of invalidArguments) {
    assert.throws(
      () => resolveRescanOutputName(argument),
      /rescan --漏扫页面\.xlsx/,
      argument || '(空参数)',
    );
  }
});

test('拒绝使用正式结果文件名', () => {
  for (const argument of ['--xpath-result.xlsx', '--XPath-Result.XLSX']) {
    assert.throws(
      () => resolveRescanOutputName(argument),
      /正式结果文件名 xpath-result\.xlsx/,
    );
  }
});

test('补扫输出路径固定在项目根目录', () => {
  assert.equal(
    resolveRescanOutputPath('/project', '--漏扫页面.xlsx', () => false),
    '/project/漏扫页面.xlsx',
  );
});

test('补扫输出文件已存在时拒绝覆盖', () => {
  assert.throws(
    () => resolveRescanOutputPath('/project', '--漏扫页面.xlsx', () => true),
    /已存在.*更换文件名/,
  );
});
