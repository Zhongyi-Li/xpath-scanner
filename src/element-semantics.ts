export type ElementSemanticInput = {
  tag: string;
  role: string;
  inputType: string;
  ownText: string;
  ariaLabel: string;
  placeholder: string;
  title: string;
  value: string;
  fieldLabel: string;
  contextLabel?: string;
  dateEndpoint?: 'start' | 'end' | '';
  isDateRangeContainer: boolean;
};

export type ElementSemantic = {
  elementName: string;
  elementType: string;
};

export type ElementRegion = 'left-navigation' | 'page-content';
export type TableElementRegion =
  | 'outside'
  | 'header-control'
  | 'row-checkbox'
  | 'row-action'
  | 'row-dynamic';

function normalizeText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function joinSemanticParts(parts: Array<string | undefined>): string {
  const result: string[] = [];
  for (const part of parts) {
    const normalized = normalizeText(part ?? '');
    if (!normalized || result.includes(normalized)) continue;
    result.push(normalized);
  }
  return result.join('-');
}

export function buildElementPath(
  hierarchySegments: string[],
  elementName: string,
  stateSegments: string[] = [],
): string {
  const segments: string[] = [];

  for (const rawSegment of [...hierarchySegments, ...stateSegments, elementName]) {
    const segment = normalizeText(rawSegment);
    if (!segment || segments.includes(segment)) continue;
    segments.push(segment);
  }

  return segments.join(' > ');
}

export function shouldCollectElementRegion(region: ElementRegion): boolean {
  return region === 'page-content';
}

export function shouldCollectTableElement(region: TableElementRegion): boolean {
  return region !== 'row-dynamic';
}

function dateEndpointName(input: ElementSemanticInput): string | null {
  if (input.dateEndpoint) {
    const unit = normalizeText(input.fieldLabel).includes('时间') ? '时间' : '日期';
    return `${input.dateEndpoint === 'end' ? '结束' : '开始'}${unit}`;
  }

  const semanticText = normalizeText(input.placeholder || input.ariaLabel || input.title);
  const match = semanticText.match(/^(起始|开始|结束)(日期|时间)$/);

  if (!match) {
    return null;
  }

  const endpoint = match[1] === '结束' ? '结束' : '开始';
  return `${endpoint}${match[2]}`;
}

function defaultElementType(input: ElementSemanticInput): string {
  const tag = normalizeText(input.tag).toLowerCase();
  const role = normalizeText(input.role).toLowerCase();
  const inputType = normalizeText(input.inputType).toLowerCase();

  if (role === 'tab') return 'Tab';
  if (role === 'clickable-card') return '可点击卡片';
  if (role === 'table-row-action') return '表格行操作';
  if (role === 'checkbox' || inputType === 'checkbox') return 'Checkbox';
  if (role === 'radio' || inputType === 'radio') return 'Radio';
  if (role === 'switch') return '开关';
  if (tag === 'select' || role === 'combobox') return '下拉框';
  if (tag === 'input' || tag === 'textarea') return '输入框';
  if (tag === 'a') return '链接';
  return '按钮';
}

function isInstructionalPlaceholder(input: string): boolean {
  return /^(请输入|请选择|请填写|请搜索|多个|输入|选择|搜索)/.test(normalizeText(input));
}

export function describeElementSemantics(input: ElementSemanticInput): ElementSemantic | null {
  const ownText = normalizeText(input.ownText);

  if (input.isDateRangeContainer && /^[-—–~～至]+$/.test(ownText)) {
    return null;
  }

  const endpointName = dateEndpointName(input);
  if (endpointName) {
    const fieldLabel = normalizeText(input.fieldLabel);
    return {
      elementName: fieldLabel ? `${fieldLabel}-${endpointName}` : endpointName,
      elementType: '日期控件',
    };
  }

  const elementName = normalizeText(
    input.ownText ||
      input.ariaLabel ||
      input.placeholder ||
      input.title ||
      input.fieldLabel ||
      input.value,
  );

  if (!elementName) {
    return null;
  }

  const role = normalizeText(input.role).toLowerCase();
  const inputType = normalizeText(input.inputType).toLowerCase();
  const elementType = defaultElementType(input);

  if (role === 'radio' || inputType === 'radio') {
    return {
      elementName: joinSemanticParts([input.fieldLabel, elementName]),
      elementType,
    };
  }

  if (role === 'combobox') {
    return {
      elementName: joinSemanticParts([input.fieldLabel, input.contextLabel, elementName]),
      elementType,
    };
  }

  if (normalizeText(input.tag).toLowerCase() === 'input' || normalizeText(input.tag).toLowerCase() === 'textarea') {
    const fieldLabel = normalizeText(input.fieldLabel);
    const placeholder = normalizeText(input.placeholder);
    if (placeholder && !isInstructionalPlaceholder(placeholder)) {
      return { elementName, elementType };
    }
    return {
      elementName: fieldLabel && !elementName.includes(fieldLabel)
        ? joinSemanticParts([fieldLabel, elementName])
        : elementName,
      elementType,
    };
  }

  return { elementName, elementType };
}
