type FieldLabelXPathInput = {
  tag: string;
  fieldLabel: string;
  visibleNodePredicate: string;
};

type ContainerContextXPathInput = {
  containerTag: string;
  containerTitle: string;
  targetTag: string;
  targetText: string;
  visibleNodePredicate: string;
};

function normalizeText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function safeXPathLiteral(input: string): string {
  if (!input.includes("'")) return `'${input}'`;
  if (!input.includes('"')) return `"${input}"`;

  const parts = input.split("'").map((part) => `'${part}'`);
  return `concat(${parts.join(`, "'", `)})`;
}

function safeTag(input: string): string | null {
  const tag = normalizeText(input).toLowerCase();
  return /^[a-z][a-z0-9-]*$/.test(tag) ? tag : null;
}

export function isStableStaticContextText(input: string): boolean {
  const text = normalizeText(input);
  if (!text || text.length > 30) return false;
  if (/\d{6,}/.test(text)) return false;
  if (/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}/.test(text)) return false;
  if (/[¥￥$€£]|\d[,.]\d{2,}/.test(text)) return false;
  if (/\b(?:id|code|no)\b\s*[:：]?\s*\d+/i.test(text)) return false;
  return true;
}

export function buildFieldLabelXPathCandidates(input: FieldLabelXPathInput): string[] {
  const tag = safeTag(input.tag);
  const fieldLabel = normalizeText(input.fieldLabel);
  const visibleNodePredicate = normalizeText(input.visibleNodePredicate);
  if (!tag || !fieldLabel || fieldLabel.length > 30 || !visibleNodePredicate) return [];

  const literal = safeXPathLiteral(fieldLabel);
  return [
    `//*[normalize-space(.)=${literal}]/ancestor-or-self::*[.//${tag}][1]//${tag}[${visibleNodePredicate}]`,
    `//*[normalize-space(translate(., '：:*', ''))=${literal}]/ancestor-or-self::*[.//${tag}][1]//${tag}[${visibleNodePredicate}]`,
  ];
}

export function buildContainerContextXPathCandidates(
  input: ContainerContextXPathInput,
): string[] {
  const containerTag = safeTag(input.containerTag);
  const targetTag = safeTag(input.targetTag);
  const containerTitle = normalizeText(input.containerTitle);
  const targetText = normalizeText(input.targetText);
  const visibleNodePredicate = normalizeText(input.visibleNodePredicate);

  if (
    !containerTag ||
    !targetTag ||
    !isStableStaticContextText(containerTitle) ||
    !targetText ||
    targetText.length > 30 ||
    !visibleNodePredicate
  ) {
    return [];
  }

  return [
    `//${containerTag}[.//*[normalize-space(.)=${safeXPathLiteral(containerTitle)}]]//${targetTag}[normalize-space(.)=${safeXPathLiteral(targetText)} and ${visibleNodePredicate}]`,
  ];
}
