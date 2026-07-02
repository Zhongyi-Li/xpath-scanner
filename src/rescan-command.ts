export type InteractiveCommand = {
  command: string;
  argument: string;
};

export function parseInteractiveCommand(line: string): InteractiveCommand {
  const normalized = line.trim();
  const separatorIndex = normalized.search(/\s/);

  if (separatorIndex === -1) {
    return {
      command: normalized.toLowerCase(),
      argument: '',
    };
  }

  return {
    command: normalized.slice(0, separatorIndex).toLowerCase(),
    argument: normalized.slice(separatorIndex).trim(),
  };
}

export function resolveRescanOutputName(argument: string): string {
  const usage = '用法：rescan --漏扫页面.xlsx';

  if (!argument.startsWith('--')) {
    throw new Error(`缺少补扫输出文件名。${usage}`);
  }

  const fileName = argument.slice(2);
  const isUnsafe =
    !fileName
    || fileName === '.xlsx'
    || /\s/.test(fileName)
    || fileName.includes('..')
    || fileName.includes('/')
    || fileName.includes('\\')
    || !fileName.toLowerCase().endsWith('.xlsx');

  if (isUnsafe) {
    throw new Error(`补扫文件名格式不正确。${usage}`);
  }

  if (fileName.toLowerCase() === 'xpath-result.xlsx') {
    throw new Error('不能使用正式结果文件名 xpath-result.xlsx，请更换补扫文件名。');
  }

  return fileName;
}

export function resolveRescanOutputPath(
  root: string,
  argument: string,
  fileExists: (filePath: string) => boolean = fs.existsSync,
): string {
  const fileName = resolveRescanOutputName(argument);
  const outputPath = path.join(root, fileName);

  if (fileExists(outputPath)) {
    throw new Error(`补扫文件 ${fileName} 已存在，请更换文件名。`);
  }

  return outputPath;
}
import fs from 'node:fs';
import path from 'node:path';
