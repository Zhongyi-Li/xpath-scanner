import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import type { Browser, Frame, Page } from 'playwright';
import * as XLSX from 'xlsx';

import { connectToLocalChrome } from './cdp-connection';
import { buildOutputColumnWidths } from './excel-layout';
import {
  buildElementPath,
  describeElementSemantics,
  shouldCollectElementRegion,
  shouldCollectTableElement,
  type ElementRegion,
  type TableElementRegion,
} from './element-semantics';
import { excludeElementRows } from './row-filter';
import { formatFramedXPath, isForbiddenFrameUrl } from './frame-locator';
import {
  parseInteractiveCommand,
  resolveRescanOutputPath,
} from './rescan-command';
import {
  buildContainerContextXPathCandidates,
  buildFieldLabelXPathCandidates,
  isStableStaticContextText,
} from './xpath-context';
import { selectStableXPath, type XPathCandidate } from './xpath-selection';
import {
  FORBIDDEN_URL_PARTS,
  SENSITIVE_FIELD_PATTERN_SOURCE,
} from './scan-policy';

type OutputRow = {
  页面路径: string;
  元素名称: string;
  元素类型: string;
  定位方式: string;
  平台: '天猫';
  成功标志: string;
  适用流程: string;
};

type Progress = {
  lastScanAt: string;
  lastUrl: string;
  lastTitle: string;
  totalRows: number;
  lastScanAdded: number;
  lastScanUpdated: number;
  lastScanSkipped: number;
};

type ScanResult = {
  pagePath: string;
  process: string;
  rows: OutputRow[];
  navigationRows: OutputRow[];
};

type RawItem = {
  tag: string;
  role: string;
  inputType: string;
  ownText: string;
  ariaLabel: string;
  placeholder: string;
  title: string;
  value: string;
  fieldLabel: string;
  contextLabel: string;
  stateSegments: string[];
  contextSegments: string[];
  tableRegion: TableElementRegion;
  dateEndpoint: 'start' | 'end' | '';
  isDateRangeContainer: boolean;
  region: ElementRegion;
  containerContext: {
    tag: string;
    title: string;
  } | null;
  xpathCandidates: XPathCandidate[];
};

type TableElementInfo = {
  region: TableElementRegion;
  contextSegments: string[];
  headerText: string;
};

type DocumentSnapshot = {
  items: RawItem[];
  hierarchySegments: string[];
};

const ROOT = process.cwd();
const ROWS_JSON = path.join(ROOT, 'xpath-rows.json');
const PROGRESS_JSON = path.join(ROOT, 'xpath-progress.json');
const RESULT_XLSX = path.join(ROOT, 'xpath-result.xlsx');
const DEBUG_LOG = path.join(ROOT, 'xpath-debug.log');
const VISIBLE_XPATH_PREDICATE =
  "not(ancestor::*[@aria-hidden='true']) and not(ancestor::*[@hidden]) and not(ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' hidden ')])";

const XSLX_COLUMNS: Array<keyof OutputRow> = [
  '页面路径',
  '元素名称',
  '元素类型',
  '定位方式',
  '平台',
  '成功标志',
  '适用流程',
];

function nowISO(): string {
  return new Date().toISOString();
}

function logDebug(message: string): void {
  const line = `[${nowISO()}] ${message}\n`;
  fs.appendFileSync(DEBUG_LOG, line, 'utf8');
}

function normalizeText(input: string | null | undefined): string {
  if (!input) {
    return '';
  }

  return input
    .replace(/\s+/g, ' ')
    .replace(/[\r\n\t]/g, ' ')
    .trim();
}

function sanitizeElementName(input: string): string {
  const base = normalizeText(input)
    .replace(/[0-9０-９][0-9０-９,，.．%％]*/g, '')
    .replace(/\b(昨日|今日|环比|同比|更新时间)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!base) {
    return '未命名元素';
  }

  return base.slice(0, 80);
}

function processFromTitle(title: string): string {
  const t = normalizeText(title);
  return t || '当前流程';
}

function rowKey(row: OutputRow): string {
  return `${row.页面路径}__${row.元素名称}__${row.元素类型}__${row.适用流程}`;
}

function scoreXPath(xpath: string): number {
  let score = 1000;
  if (xpath.includes('starts-with(')) score -= 50;
  if (xpath.includes('contains(')) score -= 40;
  if (xpath.includes('[1]')) score -= 25;
  if (xpath.includes('@id=')) score -= 20;
  if (xpath.length < 120) score += 20;
  return score;
}

function readRowsFile(): OutputRow[] {
  if (!fs.existsSync(ROWS_JSON)) {
    return [];
  }

  try {
    const data = JSON.parse(fs.readFileSync(ROWS_JSON, 'utf8')) as OutputRow[];
    if (!Array.isArray(data)) {
      return [];
    }

    return data
      .map((row) => ({
        页面路径: normalizeText(row.页面路径),
        元素名称: sanitizeElementName(row.元素名称),
        元素类型: normalizeText(row.元素类型),
        定位方式: normalizeText(row.定位方式),
        平台: '天猫' as const,
        成功标志: normalizeText(row.成功标志) || '成功',
        适用流程: normalizeText(row.适用流程) || '当前流程',
      }))
      .filter((row) => row.页面路径 && row.元素名称 && row.元素类型 && row.定位方式);
  } catch (error) {
    logDebug(`readRowsFile error: ${(error as Error).message}`);
    return [];
  }
}

function writeRowsFile(rows: OutputRow[]): void {
  fs.writeFileSync(ROWS_JSON, JSON.stringify(rows, null, 2), 'utf8');
}

function writeProgress(progress: Progress): void {
  fs.writeFileSync(PROGRESS_JSON, JSON.stringify(progress, null, 2), 'utf8');
}

function writeExcel(rows: OutputRow[], outputPath: string = RESULT_XLSX): void {
  const normalizedRows = rows.map((row) => {
    const r = { ...row };
    r.平台 = '天猫';
    return r;
  });

  const worksheet = XLSX.utils.json_to_sheet(normalizedRows, {
    header: XSLX_COLUMNS,
  });
  worksheet['!cols'] = buildOutputColumnWidths(XSLX_COLUMNS.length);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'XPath清单');
  XLSX.writeFile(workbook, outputPath);
}

function mergeRows(existing: OutputRow[], incoming: OutputRow[]): { merged: OutputRow[]; added: number; updated: number; skipped: number } {
  const map = new Map<string, OutputRow>();

  for (const row of existing) {
    map.set(rowKey(row), row);
  }

  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of incoming) {
    const key = rowKey(row);
    const prev = map.get(key);

    if (!prev) {
      map.set(key, row);
      added += 1;
      continue;
    }

    if (prev.定位方式 === row.定位方式) {
      skipped += 1;
      continue;
    }

    if (scoreXPath(row.定位方式) >= scoreXPath(prev.定位方式)) {
      map.set(key, row);
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    merged: [...map.values()],
    added,
    updated,
    skipped,
  };
}

async function pickActivePage(browser: Browser): Promise<Page | null> {
  const allPages = browser
    .contexts()
    .flatMap((context) => context.pages())
    .filter((page) => !page.isClosed());

  if (!allPages.length) {
    return null;
  }

  const reversed = [...allPages].reverse();

  for (const page of reversed) {
    try {
      const focused = await page.evaluate(() => document.hasFocus());
      if (focused) {
        return page;
      }
    } catch {
      // ignore detached pages
    }
  }

  return reversed[0] ?? null;
}

function isForbiddenForScan(url: string): string | null {
  const lower = url.toLowerCase();

  for (const part of FORBIDDEN_URL_PARTS) {
    if (lower.includes(part)) {
      return `当前页面不可扫描：命中规则 ${part}`;
    }
  }

  return null;
}

async function collectDocumentSnapshot(
  target: Page | Frame,
  includePageHierarchy: boolean,
): Promise<DocumentSnapshot> {
  const snapshot = await target.evaluate(({ includeHierarchy, sensitiveFieldPatternSource }) => {
    const hiddenExpr = "not(ancestor::*[@aria-hidden='true']) and not(ancestor::*[@hidden]) and not(ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' hidden ')])";

    const selector = [
      'button',
      'a[href]',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      'label:has(input[type="radio"])',
      'label:has(input[type="checkbox"])',
      '[role="button"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[role="switch"]',
      '[role="combobox"]',
      '[contenteditable="true"]',
      '[onclick]',
      '[class*="mod-select-"] .selected-wrap',
      '[class*="mod-fullbtnlist"] .button-item',
      '.radio-item',
    ].join(',');

    const standardCandidates = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const frameworkCardCandidates = Array.from(
      document.querySelectorAll<HTMLElement>('div, section, article, li'),
    ).filter(isFrameworkClickableCard);
    const candidates = [...standardCandidates, ...frameworkCardCandidates];
    const uniq = Array.from(new Set(candidates));

    function isVisible(el: HTMLElement): boolean {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return false;
      }

      if (el.closest('[aria-hidden="true"], [hidden], .hidden')) {
        return false;
      }

      return true;
    }

    function isDisabled(el: HTMLElement): boolean {
      const nestedControl = el.matches('label')
        ? el.querySelector<HTMLElement>('input, select, textarea, button')
        : null;
      const control = nestedControl ?? el;
      const disabledAttr = control.getAttribute('disabled');
      const ariaDisabled = control.getAttribute('aria-disabled');
      return disabledAttr !== null || ariaDisabled === 'true';
    }

    function isSensitiveEditableControl(el: HTMLElement): boolean {
      const control = el.matches('label')
        ? el.querySelector<HTMLElement>('input, textarea') ?? el
        : el;
      const tag = control.tagName.toLowerCase();
      if (tag !== 'input' && tag !== 'textarea') return false;
      if (normalizeText(control.getAttribute('type')).toLowerCase() === 'password') return true;

      const attributes = [
        control.getAttribute('name'),
        control.getAttribute('id'),
        control.getAttribute('aria-label'),
        control.getAttribute('placeholder'),
        control.getAttribute('autocomplete'),
      ].map(normalizeText);
      return new RegExp(sensitiveFieldPatternSource, 'i').test(attributes.join(' '));
    }

    function normalizeText(input: string | null | undefined): string {
      if (!input) return '';
      return input.replace(/\s+/g, ' ').trim();
    }

    function elementText(el: HTMLElement): string {
      if (el.tagName.toLowerCase() !== 'label') {
        return normalizeText(el.textContent);
      }

      const clone = el.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll('input, select, textarea, button, [role="combobox"], .next-select')
        .forEach((child) => child.remove());
      return normalizeText(clone.textContent);
    }

    function hasFrameworkClickHandler(el: HTMLElement): boolean {
      const record = el as unknown as Record<string, unknown>;
      for (const key of Object.keys(el)) {
        if (!key.startsWith('__reactProps$') && !key.startsWith('__reactEventHandlers$')) continue;
        const props = record[key] as { onClick?: unknown } | undefined;
        if (typeof props?.onClick === 'function') return true;
      }
      return false;
    }

    function stableCardAttribute(el: HTMLElement): { name: string; value: string } | null {
      for (const name of ['data-testid', 'data-test', 'data-index', 'data-id', 'data-key']) {
        const value = normalizeText(el.getAttribute(name));
        if (value && value.length <= 80) return { name, value };
      }
      return null;
    }

    function cardTitleFor(el: HTMLElement): string {
      const explicit = normalizeText(
        el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-title'),
      );
      if (explicit && explicit.length <= 50) return explicit;

      const candidates = Array.from(
        el.querySelectorAll<HTMLElement>(
          'h1, h2, h3, h4, h5, h6, [role="heading"], [class*="title"], img[alt]',
        ),
      )
        .map((node) => normalizeText(node.getAttribute('alt') || node.textContent))
        .map((text) => text.replace(/^(NEW|HOT|NEW\s+HOT)\s*/i, '').trim())
        .filter((text) => text && text.length <= 50)
        .sort((left, right) => left.length - right.length);
      if (candidates[0]) return candidates[0];

      return normalizeText(el.innerText)
        .split(/\r?\n/)
        .map((text) => text.replace(/^(NEW|HOT|NEW\s+HOT)\s*/i, '').trim())
        .find((text) => text && text.length <= 50) ?? '';
    }

    function isFrameworkClickableCard(el: HTMLElement): boolean {
      if (el.matches('button, a, input, select, textarea, [role], [onclick]')) return false;
      if (!stableCardAttribute(el) || !cardTitleFor(el) || el.children.length === 0) return false;
      if (hasFrameworkClickHandler(el)) return true;
      return window.getComputedStyle(el).cursor === 'pointer';
    }

    function contextLabelFor(el: HTMLElement): string {
      if (normalizeText(el.getAttribute('role')) !== 'combobox') return '';
      const optionLabel = el.closest<HTMLElement>('label:has(input[type="radio"])');
      return optionLabel ? elementText(optionLabel) : '';
    }

    function containerContextFor(el: HTMLElement): { tag: string; title: string } | null {
      let current = el.parentElement;
      let depth = 0;

      while (current && depth < 8) {
        const isSemanticContainer = current.matches(
          'section, article, [role="region"], [role="dialog"], [data-testid], [data-test]',
        );
        if (isSemanticContainer && !current.closest('table, [role="table"], [role="grid"]')) {
          const headings = Array.from(
            current.querySelectorAll<HTMLElement>(
              ':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > [role="heading"], :scope > header [role="heading"], :scope > header [class*="title"]',
            ),
          );
          const title = headings
            .map((heading) => normalizeText(heading.textContent))
            .find((text) => text && text.length <= 30);
          if (title) return { tag: current.tagName.toLowerCase(), title };
        }

        current = current.parentElement;
        depth += 1;
      }

      return null;
    }

    function activeRadioOption(formItem: HTMLElement): string {
      const checked = formItem.querySelector<HTMLInputElement>(
        'input[type="radio"]:checked, input[type="radio"][aria-checked="true"]',
      );
      const optionLabel = checked?.closest<HTMLElement>('label');
      return optionLabel ? elementText(optionLabel) : '';
    }

    function stateSegmentsFor(el: HTMLElement): string[] {
      const currentItem = el.closest<HTMLElement>('.next-form-item');
      const form = currentItem?.closest<HTMLFormElement>('form');
      if (!currentItem || !form) return [];

      const formItems = Array.from(form.querySelectorAll<HTMLElement>('.next-form-item'))
        .filter((item) => item.closest('form') === form)
        .filter((item) => !item.parentElement?.closest('.next-form-item'));
      const currentIndex = formItems.indexOf(currentItem);
      if (currentIndex <= 0) return [];

      return formItems
        .slice(0, currentIndex)
        .map(activeRadioOption)
        .filter(Boolean);
    }

    function tableInfoFor(el: HTMLElement): TableElementInfo {
      const outside: TableElementInfo = {
        region: 'outside',
        contextSegments: [],
        headerText: '',
      };
      const table = el.closest<HTMLElement>('table, [role="table"], [role="grid"]');
      if (!table) return outside;

      const headerCell = el.closest<HTMLElement>('thead th, [role="columnheader"]');
      if (headerCell && table.contains(headerCell)) {
        return {
          region: 'header-control',
          contextSegments: ['表格'],
          headerText: normalizeText(headerCell.textContent),
        };
      }

      const row = el.closest<HTMLElement>('tbody tr, [role="row"]');
      const cell = el.closest<HTMLElement>('td, [role="gridcell"]');
      if (!row || !cell || !table.contains(row)) return outside;

      const cells = Array.from(
        row.querySelectorAll<HTMLElement>(':scope > td, :scope > [role="gridcell"]'),
      );
      const cellIndex = cells.indexOf(cell);
      const headers = Array.from(
        table.querySelectorAll<HTMLElement>('thead th, [role="columnheader"]'),
      );
      const headerText = cellIndex >= 0 ? normalizeText(headers[cellIndex]?.textContent) : '';
      const control = el.matches('label')
        ? el.querySelector<HTMLElement>('input[type="checkbox"], [role="checkbox"]')
        : el;
      const isCheckbox =
        control?.getAttribute('type') === 'checkbox' ||
        normalizeText(control?.getAttribute('role')).toLowerCase() === 'checkbox';

      if (isCheckbox) {
        return {
          region: 'row-checkbox',
          contextSegments: ['表格行'],
          headerText,
        };
      }
      if (/^(操作|动作)$/.test(headerText)) {
        return {
          region: 'row-action',
          contextSegments: ['表格行'],
          headerText,
        };
      }
      return {
        region: 'row-dynamic',
        contextSegments: ['表格行'],
        headerText,
      };
    }

    function isDateEndpointPlaceholder(input: string): boolean {
      return /^(起始|开始|结束)(日期|时间)$/.test(normalizeText(input));
    }

    function isUsableFieldLabel(input: string): boolean {
      const text = normalizeText(input);
      return Boolean(
        text &&
          text.length <= 30 &&
          !/^[-—–~～至]+$/.test(text) &&
          !isDateEndpointPlaceholder(text),
      );
    }

    function cleanFieldLabel(input: string): string {
      return normalizeText(input).replace(/[：:*]+$/g, '').trim();
    }

    function dateRangeInfoFor(el: HTMLElement): {
      fieldLabel: string;
      endpoint: 'start' | 'end' | '';
    } {
      if (!el.matches('input[readonly]')) return { fieldLabel: '', endpoint: '' };

      let container = el.parentElement;
      let depth = 0;
      while (container && depth < 6) {
        const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[readonly]'));
        const containerText = normalizeText(container.textContent);
        if (inputs.length === 2 && /[至~～]/.test(containerText)) {
          const index = inputs.indexOf(el as HTMLInputElement);
          if (index < 0) return { fieldLabel: '', endpoint: '' };

          const firstBranch = inputs[0]?.parentElement?.parentElement;
          const firstBranchText = normalizeText(firstBranch?.textContent)
            .replace(/[至~～]/g, '')
            .replace(/[：:*]+$/g, '')
            .trim();
          return {
            fieldLabel: firstBranchText,
            endpoint: index === 0 ? 'start' : 'end',
          };
        }
        container = container.parentElement;
        depth += 1;
      }

      return { fieldLabel: '', endpoint: '' };
    }

    function fieldLabelFor(el: HTMLElement): string {
      const dateRangeInfo = dateRangeInfoFor(el);
      if (isUsableFieldLabel(dateRangeInfo.fieldLabel)) {
        return cleanFieldLabel(dateRangeInfo.fieldLabel);
      }

      const legacySelect = el.closest<HTMLElement>('[class*="mod-select-"]');
      const legacySelectTitle = normalizeText(
        legacySelect?.querySelector<HTMLElement>('.select-title')?.textContent,
      );
      if (isUsableFieldLabel(legacySelectTitle)) {
        return cleanFieldLabel(legacySelectTitle);
      }

      const labelledBy = normalizeText(el.getAttribute('aria-labelledby'));
      if (labelledBy) {
        const labelledText = labelledBy
          .split(/\s+/)
          .map((id) => normalizeText(document.getElementById(id)?.textContent))
          .filter(Boolean)
          .join(' ');
        if (isUsableFieldLabel(labelledText)) return cleanFieldLabel(labelledText);
      }

      if (el.id) {
        const explicitLabel = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(el.id)}"]`);
        const explicitText = normalizeText(explicitLabel?.textContent);
        if (isUsableFieldLabel(explicitText)) return cleanFieldLabel(explicitText);
      }

      const enclosingOption = el.closest<HTMLElement>(
        'label:has(input[type="radio"]), label:has(input[type="checkbox"])',
      );
      let branch: HTMLElement = enclosingOption ?? el;
      let parent = branch.parentElement;
      let depth = 0;

      while (parent && depth < 10) {
        if (branch.matches('form')) break;

        const children = Array.from(parent.children);
        const branchIndex = children.indexOf(branch);

        for (let index = branchIndex - 1; index >= 0; index -= 1) {
          const sibling = children[index] as HTMLElement;
          if (sibling.matches('input, select, textarea, button, a, [role]')) continue;
          if (sibling.querySelector('input, select, textarea, button, a, [role]')) continue;

          const siblingText = normalizeText(sibling.textContent);
          if (isUsableFieldLabel(siblingText)) return cleanFieldLabel(siblingText);
        }

        branch = parent;
        parent = parent.parentElement;
        depth += 1;
      }

      return '';
    }

    function isDateRangeContainer(el: HTMLElement): boolean {
      const placeholders = Array.from(el.querySelectorAll<HTMLInputElement>('input[placeholder]'))
        .map((input) => normalizeText(input.getAttribute('placeholder')))
        .filter(isDateEndpointPlaceholder);

      const hasStart = placeholders.some((placeholder) => /^(起始|开始)(日期|时间)$/.test(placeholder));
      const hasEnd = placeholders.some((placeholder) => /^结束(日期|时间)$/.test(placeholder));
      return hasStart && hasEnd;
    }

    function firstVisibleText(selector: string): string {
      const elements = Array.from(document.querySelectorAll<HTMLElement>(selector));
      for (const element of elements) {
        if (!isVisible(element)) continue;
        const text = normalizeText(element.textContent);
        if (text && text.length <= 80) return text;
      }
      return '';
    }

    function collectHierarchySegments(): string[] {
      const primaryNavigation = firstVisibleText(
        'a[role="button"][class*="selectedNavItem"], [role="navigation"] [aria-current="page"]',
      );
      const selectedMenuItem = firstVisibleText(
        'li[role="menuitem"].tbd-menu-item-selected, [role="menuitem"][aria-current="page"], [role="menuitem"][aria-selected="true"]',
      );
      const activeTabs = Array.from(
        document.querySelectorAll<HTMLElement>('[role="tab"][aria-selected="true"]'),
      )
        .filter(isVisible)
        .map((element) => normalizeText(element.textContent))
        .filter((text) => text && text.length <= 80);

      const activeViewSwitches = Array.from(
        document.querySelectorAll<HTMLElement>(
          '.radio-item.filter-btn-active, .radio-item.active, .radio-item[aria-selected="true"]',
        ),
      )
        .filter(isVisible)
        .map((element) => normalizeText(element.textContent))
        .filter((text) => text && text.length <= 80);

      if (!includeHierarchy) {
        return [...activeTabs, ...activeViewSwitches];
      }

      return [
        primaryNavigation,
        selectedMenuItem,
        normalizeText(document.title),
        ...activeTabs,
        ...activeViewSwitches,
      ]
        .filter(Boolean);
    }

    function elementRegion(el: HTMLElement): ElementRegion {
      const primaryNavigation = el.closest('[class*="firstClassMenu"]');
      const secondaryNavigation = el.closest('ul[role="menu"][class*="menuContainer"]');
      return primaryNavigation || secondaryNavigation ? 'left-navigation' : 'page-content';
    }

    function xpathCount(xpath: string): number {
      try {
        const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        return result.snapshotLength;
      } catch {
        return 0;
      }
    }

    function safeLiteral(text: string): string {
      if (!text.includes("'")) {
        return `'${text}'`;
      }
      if (!text.includes('"')) {
        return `"${text}"`;
      }
      const parts = text.split("'").map((part) => `'${part}'`);
      return `concat(${parts.join(`, "'", `)})`;
    }

    function buildTableXPathCandidates(
      el: HTMLElement,
      text: string,
      tableInfo: TableElementInfo,
    ): XPathCandidate[] | null {
      if (tableInfo.region === 'outside' || tableInfo.region === 'row-dynamic') return null;
      const table = el.closest<HTMLElement>('table, [role="table"], [role="grid"]');
      if (!table) return null;

      const tableTag = table.tagName.toLowerCase();
      const tableRole = normalizeText(table.getAttribute('role'));
      let tableXPath = tableTag === 'table'
        ? '//table'
        : `//${tableTag}[@role=${safeLiteral(tableRole)}]`;
      if (tableInfo.headerText) {
        const headerPredicate = tableTag === 'table'
          ? `.//thead//th[normalize-space(.)=${safeLiteral(tableInfo.headerText)}]`
          : `.//*[@role='columnheader' and normalize-space(.)=${safeLiteral(tableInfo.headerText)}]`;
        tableXPath += `[${headerPredicate}]`;
      }

      const tag = el.tagName.toLowerCase();
      const axis = tableInfo.region === 'header-control' ? '//thead//' : '//tbody//';
      let controlXPath = '';
      if (tableInfo.region === 'row-action') {
        controlXPath = `${tag}[normalize-space(.)=${safeLiteral(text)} and ${hiddenExpr}]`;
      } else if (el.matches('label')) {
        controlXPath = `${tag}[.//input[@type='checkbox'] and ${hiddenExpr}]`;
      } else if (el.getAttribute('type') === 'checkbox') {
        controlXPath = `${tag}[@type='checkbox' and ${hiddenExpr}]`;
      } else {
        controlXPath = `${tag}[@role='checkbox' and ${hiddenExpr}]`;
      }

      const xpath = `${tableXPath}${axis}${controlXPath}`;
      return [{ xpath, count: xpathCount(xpath) }];
    }

    function buildXPathCandidates(
      el: HTMLElement,
      preferredText = '',
      tableInfo: TableElementInfo = { region: 'outside', contextSegments: [], headerText: '' },
    ): XPathCandidate[] {
      const tag = el.tagName.toLowerCase();
      const role = normalizeText(el.getAttribute('role'));
      const aria = normalizeText(el.getAttribute('aria-label'));
      const placeholder = normalizeText(el.getAttribute('placeholder'));
      const name = normalizeText(el.getAttribute('name'));
      const text = preferredText || elementText(el);
      const title = normalizeText(el.getAttribute('title'));

      const tableCandidates = buildTableXPathCandidates(el, text, tableInfo);
      if (tableCandidates) return tableCandidates;

      const checks: string[] = [];

      if (role && role.length <= 30 && text && text.length <= 30) {
        checks.push(
          `//${tag}[@role=${safeLiteral(role)} and normalize-space(.)=${safeLiteral(text)} and ${hiddenExpr}]`,
        );
        checks.push(
          `//${tag}[@role=${safeLiteral(role)} and starts-with(normalize-space(.), ${safeLiteral(text)}) and ${hiddenExpr}]`,
        );
      }

      if (aria && aria.length <= 50) {
        checks.push(`//${tag}[@aria-label=${safeLiteral(aria)} and ${hiddenExpr}]`);
      }
      if (isFrameworkClickableCard(el)) {
        const stableAttribute = stableCardAttribute(el);
        if (stableAttribute) {
          checks.push(
            `//${tag}[@${stableAttribute.name}=${safeLiteral(stableAttribute.value)} and ${hiddenExpr}]`,
          );
        }
      }
      if (placeholder && placeholder.length <= 50) {
        checks.push(`//${tag}[@placeholder=${safeLiteral(placeholder)} and ${hiddenExpr}]`);
      }
      if (name && name.length <= 50) {
        checks.push(`//${tag}[@name=${safeLiteral(name)} and ${hiddenExpr}]`);
      }
      if (role && role.length <= 30) {
        checks.push(`//${tag}[@role=${safeLiteral(role)} and ${hiddenExpr}]`);
      }
      if (title && title.length <= 50) {
        checks.push(`//${tag}[@title=${safeLiteral(title)} and ${hiddenExpr}]`);
      }
      if (text && text.length <= 30) {
        checks.push(`//${tag}[normalize-space(.)=${safeLiteral(text)} and ${hiddenExpr}]`);
        checks.push(`//${tag}[starts-with(normalize-space(.), ${safeLiteral(text)}) and ${hiddenExpr}]`);
      }

      let current: HTMLElement | null = el;
      let level = 0;
      const segments: string[] = [];

      while (current && level < 4) {
        const currentTag = current.tagName.toLowerCase();
        const currentRole = normalizeText(current.getAttribute('role'));
        const currentText = (current === el ? text : elementText(current)).slice(0, 24);

        let seg = currentTag;

        if (currentRole) {
          seg += `[@role=${safeLiteral(currentRole)}]`;
        } else if (currentText) {
          seg += `[starts-with(normalize-space(.), ${safeLiteral(currentText)})]`;
        }

        segments.unshift(seg);
        current = current.parentElement;
        level += 1;
      }

      checks.push(`//${segments.join('/')}[${hiddenExpr}]`);
      return checks.map((xpath) => ({ xpath, count: xpathCount(xpath) }));
    }

    const items: RawItem[] = [];

    for (const el of uniq) {
      if (!isVisible(el)) continue;
      if (isDisabled(el)) continue;
      if (isSensitiveEditableControl(el)) continue;

      const tableInfo = tableInfoFor(el);
      if (tableInfo.region === 'row-dynamic') continue;

      const clickableCard = isFrameworkClickableCard(el);
      const baseText = clickableCard ? cardTitleFor(el) : elementText(el);
      const text = tableInfo.region === 'row-checkbox'
        ? '选择行'
        : tableInfo.region === 'header-control' &&
            (el.getAttribute('type') === 'checkbox' || el.querySelector('input[type="checkbox"]'))
          ? '全选'
          : baseText;
      const aria = normalizeText(el.getAttribute('aria-label'));
      const placeholder = normalizeText(el.getAttribute('placeholder'));
      const title = normalizeText(el.getAttribute('title'));
      const value = '';
      const fieldLabel = fieldLabelFor(el);
      const dateRangeInfo = dateRangeInfoFor(el);
      const effectiveRole = el.matches('[class*="mod-select-"] .selected-wrap')
        ? 'combobox'
        : el.matches('[class*="mod-fullbtnlist"] .button-item')
          ? 'button'
          : el.matches('.radio-item')
            ? 'tab'
            : clickableCard
              ? 'clickable-card'
              : tableInfo.region === 'row-action'
                ? 'table-row-action'
              : normalizeText(el.getAttribute('role'));

      const nameSource = text || aria || placeholder || title || fieldLabel;
      if (!nameSource) continue;

      const xpathCandidates = buildXPathCandidates(el, text, tableInfo);
      if (!xpathCandidates.some((candidate) => candidate.count > 0)) continue;

      items.push({
        tag: el.tagName.toLowerCase(),
        role: effectiveRole,
        inputType: normalizeText(
          el.getAttribute('type') ??
            el.querySelector<HTMLInputElement>('input[type="radio"], input[type="checkbox"]')?.type,
        ),
        ownText: text,
        ariaLabel: aria,
        placeholder,
        title,
        value,
        fieldLabel,
        contextLabel: contextLabelFor(el),
        stateSegments: stateSegmentsFor(el),
        contextSegments: tableInfo.contextSegments,
        tableRegion: tableInfo.region,
        dateEndpoint: dateRangeInfo.endpoint,
        isDateRangeContainer: isDateRangeContainer(el),
        region: elementRegion(el),
        containerContext: containerContextFor(el),
        xpathCandidates,
      });

      if (items.length >= 300) {
        break;
      }
    }

    return {
      items,
      hierarchySegments: collectHierarchySegments(),
    };
  }, { includeHierarchy: includePageHierarchy, sensitiveFieldPatternSource: SENSITIVE_FIELD_PATTERN_SOURCE });

  for (const item of snapshot.items) {
    if (item.xpathCandidates.some((candidate) => candidate.count === 1)) continue;

    const contextualXPaths: string[] = [];
    if (
      item.fieldLabel &&
      (item.tag === 'input' || item.tag === 'textarea' || item.tag === 'select' || item.role === 'combobox')
    ) {
      contextualXPaths.push(
        ...buildFieldLabelXPathCandidates({
          tag: item.tag,
          fieldLabel: item.fieldLabel,
          visibleNodePredicate: VISIBLE_XPATH_PREDICATE,
        }),
      );
    }

    if (
      item.containerContext &&
      item.ownText &&
      isStableStaticContextText(item.containerContext.title)
    ) {
      contextualXPaths.push(
        ...buildContainerContextXPathCandidates({
          containerTag: item.containerContext.tag,
          containerTitle: item.containerContext.title,
          targetTag: item.tag,
          targetText: item.ownText,
          visibleNodePredicate: VISIBLE_XPATH_PREDICATE,
        }),
      );
    }

    const uniqueXPaths = [...new Set(contextualXPaths)].filter(
      (xpath) => !item.xpathCandidates.some((candidate) => candidate.xpath === xpath),
    );
    if (!uniqueXPaths.length) continue;

    const counts = await target.evaluate((xpaths) =>
      xpaths.map((xpath) => {
        try {
          return document.evaluate(
            xpath,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null,
          ).snapshotLength;
        } catch {
          return 0;
        }
      }), uniqueXPaths);

    item.xpathCandidates = [
      ...uniqueXPaths.map((xpath, index) => ({ xpath, count: counts[index] ?? 0 })),
      ...item.xpathCandidates,
    ];
  }

  return snapshot;
}

async function frameXPathChain(frame: Frame): Promise<string[] | null> {
  const chain: string[] = [];
  let current: Frame | null = frame;

  while (current?.parentFrame()) {
    const frameElement = await current.frameElement();
    const xpath = await frameElement.evaluate((element) => {
      const el = element as HTMLElement;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0' ||
        rect.width <= 0 ||
        rect.height <= 0 ||
        el.closest('[aria-hidden="true"], [hidden], .hidden')
      ) {
        return null;
      }

      function normalizeText(input: string | null): string {
        return (input ?? '').replace(/\s+/g, ' ').trim();
      }

      function safeLiteral(text: string): string {
        if (!text.includes("'")) return `'${text}'`;
        if (!text.includes('"')) return `"${text}"`;
        return `concat(${text.split("'").map((part) => `'${part}'`).join(`, "'", `)})`;
      }

      function xpathCount(candidate: string): number {
        try {
          return document.evaluate(
            candidate,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null,
          ).snapshotLength;
        } catch {
          return 0;
        }
      }

      const tag = el.tagName.toLowerCase();
      const candidates: string[] = [];
      const name = normalizeText(el.getAttribute('name'));
      const title = normalizeText(el.getAttribute('title'));
      const src = normalizeText(el.getAttribute('src'));

      if (name && name.length <= 80) candidates.push(`//${tag}[@name=${safeLiteral(name)}]`);
      if (title && title.length <= 80) candidates.push(`//${tag}[@title=${safeLiteral(title)}]`);
      if (src) {
        try {
          const path = new URL(src, document.baseURI).pathname;
          if (path && path !== '/' && path.length <= 160) {
            candidates.push(`//${tag}[contains(@src, ${safeLiteral(path)})]`);
          }
        } catch {
          // Ignore malformed src and use the structural fallback below.
        }
      }

      for (const candidate of candidates) {
        if (xpathCount(candidate) === 1) return candidate;
      }

      const siblings = Array.from(document.querySelectorAll(tag));
      const index = siblings.indexOf(el);
      return index >= 0 ? `//${tag}[${index + 1}]` : null;
    });

    if (!xpath) return null;
    chain.unshift(xpath);
    current = current.parentFrame();
  }

  return chain;
}

async function collectRows(page: Page): Promise<ScanResult> {
  const title = await page.title();
  const process = processFromTitle(title);
  const mainSnapshot = await collectDocumentSnapshot(page, true);
  const snapshots: Array<{ snapshot: DocumentSnapshot; frameXPaths: string[] }> = [
    { snapshot: mainSnapshot, frameXPaths: [] },
  ];

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    if (!frame.url() || isForbiddenFrameUrl(frame.url(), FORBIDDEN_URL_PARTS)) continue;

    try {
      const frameXPaths = await frameXPathChain(frame);
      if (!frameXPaths) continue;
      const snapshot = await collectDocumentSnapshot(frame, false);
      if (!snapshot.items.length) continue;
      snapshots.push({ snapshot, frameXPaths });
    } catch (error) {
      logDebug(`frame scan skipped: url=${frame.url()} error=${(error as Error).message}`);
    }
  }

  const rows: OutputRow[] = [];
  const navigationRows: OutputRow[] = [];

  for (const { snapshot, frameXPaths } of snapshots) {
    const hierarchySegments = [
      ...mainSnapshot.hierarchySegments,
      ...(frameXPaths.length ? snapshot.hierarchySegments : []),
    ];

    for (const item of snapshot.items) {
      if (!shouldCollectTableElement(item.tableRegion)) continue;
      const selectedXPath = selectStableXPath(item.xpathCandidates);
      if (!selectedXPath) continue;

      const semantic = describeElementSemantics(item);
      if (!semantic) continue;

      const elementName = sanitizeElementName(semantic.elementName);
      const row: OutputRow = {
        页面路径: buildElementPath(
          hierarchySegments,
          elementName,
          [...item.stateSegments, ...item.contextSegments],
        ),
        元素名称: elementName,
        元素类型: normalizeText(semantic.elementType) || '按钮',
        定位方式: frameXPaths.length
          ? formatFramedXPath(frameXPaths, selectedXPath.xpath)
          : normalizeText(selectedXPath.xpath),
        平台: '天猫',
        成功标志: selectedXPath.successFlag,
        适用流程: process,
      };

      if (shouldCollectElementRegion(item.region)) {
        rows.push(row);
      } else {
        navigationRows.push(row);
      }
    }
  }

  const pagePath = buildElementPath(mainSnapshot.hierarchySegments, '');

  return {
    pagePath,
    process,
    rows,
    navigationRows,
  };
}

async function printCurrentUrl(browser: Browser): Promise<void> {
  const page = await pickActivePage(browser);
  if (!page) {
    console.log('未发现可用页面，请先在 Chrome 中打开目标页面。');
    return;
  }

  const title = await page.title();
  console.log(`URL: ${page.url()}`);
  console.log(`标题: ${title}`);
}

async function printPages(browser: Browser): Promise<void> {
  const pages = browser
    .contexts()
    .flatMap((ctx) => ctx.pages())
    .filter((p) => !p.isClosed());

  if (!pages.length) {
    console.log('当前没有可用页面。');
    return;
  }

  for (let i = 0; i < pages.length; i += 1) {
    const p = pages[i]!;
    let title = '';
    try {
      title = await p.title();
    } catch {
      title = '(无法读取标题)';
    }
    console.log(`${i + 1}. ${title} -> ${p.url()}`);
  }
}

function printHelp(): void {
  console.log('可用命令:');
  console.log('  scan   扫描当前激活页面');
  console.log('  rescan --文件名.xlsx  补扫当前激活页面，仅生成独立 Excel，不更新正式结果和进度');
  console.log('  url    打印当前页面 URL 和标题');
  console.log('  pages  列出当前 Chrome 中打开的页面');
  console.log('  help   显示帮助');
  console.log('  exit   退出脚本');
}

async function executeRescan(browser: Browser, argument: string): Promise<void> {
  const outputPath = resolveRescanOutputPath(ROOT, argument);
  const page = await pickActivePage(browser);
  if (!page) {
    console.log('未发现可用页面，请先手动打开业务页面。');
    return;
  }

  const forbidden = isForbiddenForScan(page.url());
  if (forbidden) {
    console.log(forbidden);
    return;
  }

  const scanResult = await collectRows(page);
  if (!scanResult.rows.length) {
    console.log('未采集到可写入元素，请确认页面已加载且存在可点击控件。');
    return;
  }

  const isolatedRows = mergeRows([], scanResult.rows).merged;
  writeExcel(isolatedRows, outputPath);
  logDebug(`rescan ok: page=${scanResult.pagePath} rows=${isolatedRows.length}`);

  console.log(`补扫完成: ${scanResult.pagePath}`);
  console.log(`本次共 ${isolatedRows.length} 条，已写入独立文件 ${path.basename(outputPath)}`);
  console.log('正式结果和进度文件未更新。');
}

async function executeScan(browser: Browser): Promise<void> {
  const page = await pickActivePage(browser);
  if (!page) {
    console.log('未发现可用页面，请先手动打开业务页面。');
    return;
  }

  const forbidden = isForbiddenForScan(page.url());
  if (forbidden) {
    console.log(forbidden);
    return;
  }

  const title = await page.title();

  const scanResult = await collectRows(page);
  if (!scanResult.rows.length) {
    console.log('未采集到可写入元素，请确认页面已加载且存在可点击控件。');
    return;
  }

  const allExisting = readRowsFile();
  const existing = excludeElementRows(allExisting, scanResult.navigationRows);
  const removedNavigationRows = allExisting.length - existing.length;
  const merged = mergeRows(existing, scanResult.rows);

  writeRowsFile(merged.merged);
  writeExcel(merged.merged);

  const progress: Progress = {
    lastScanAt: nowISO(),
    lastUrl: page.url(),
    lastTitle: title,
    totalRows: merged.merged.length,
    lastScanAdded: merged.added,
    lastScanUpdated: merged.updated,
    lastScanSkipped: merged.skipped,
  };
  writeProgress(progress);

  logDebug(`scan ok: page=${scanResult.pagePath} added=${merged.added} updated=${merged.updated} skipped=${merged.skipped}`);

  console.log(`扫描完成: ${scanResult.pagePath}`);
  if (removedNavigationRows > 0) {
    console.log(`已清理历史左侧导航 ${removedNavigationRows} 条。`);
  }
  console.log(`新增 ${merged.added} 条，更新 ${merged.updated} 条，跳过 ${merged.skipped} 条。`);
  console.log(`累计 ${merged.merged.length} 条，已写入 xpath-rows.json / xpath-progress.json / xpath-result.xlsx`);
}

async function main(): Promise<void> {
  console.log('正在连接本地 Chrome: http://127.0.0.1:9222');

  const browser = await connectToLocalChrome();
  logDebug('connected cdp browser');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'xpath-scan> ',
  });

  printHelp();
  rl.prompt();

  rl.on('line', async (line) => {
    const { command: cmd, argument } = parseInteractiveCommand(line);

    try {
      if (cmd === 'scan') {
        await executeScan(browser);
      } else if (cmd === 'rescan') {
        await executeRescan(browser, argument);
      } else if (cmd === 'url') {
        await printCurrentUrl(browser);
      } else if (cmd === 'pages') {
        await printPages(browser);
      } else if (cmd === 'help') {
        printHelp();
      } else if (cmd === 'exit') {
        rl.close();
        return;
      } else if (!cmd) {
        // no-op
      } else {
        console.log(`未知命令: ${cmd}`);
        printHelp();
      }
    } catch (error) {
      const msg = (error as Error).message;
      console.log(`执行失败: ${msg}`);
      logDebug(`command error: cmd=${cmd} msg=${msg}`);
    }

    rl.prompt();
  });

  rl.on('close', async () => {
    console.log('扫描脚本已退出。');
    try {
      await browser.close();
    } catch {
      // ignore
    }
    process.exit(0);
  });
}

main().catch((error) => {
  const msg = (error as Error).message;
  console.error(`启动失败: ${msg}`);
  logDebug(`startup error: ${msg}`);
  process.exit(1);
});
