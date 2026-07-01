function normalizeText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function formatFramedXPath(frameXPaths: string[], elementXPath: string): string {
  const frameParts = frameXPaths
    .map(normalizeText)
    .filter(Boolean)
    .map((xpath) => `frame=${xpath}`);
  const childXPath = normalizeText(elementXPath);

  return [...frameParts, `xpath=${childXPath}`].join(' >>> ');
}

export function isForbiddenFrameUrl(url: string, forbiddenParts: string[]): boolean {
  const lowerUrl = normalizeText(url).toLowerCase();
  return forbiddenParts.some((part) => lowerUrl.includes(normalizeText(part).toLowerCase()));
}
