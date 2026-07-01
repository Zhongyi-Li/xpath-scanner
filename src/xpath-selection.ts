export type XPathCandidate = {
  xpath: string;
  count: number;
};

export type SelectedXPath = {
  xpath: string;
  successFlag: '成功' | '多元素命中';
};

export function selectStableXPath(candidates: XPathCandidate[]): SelectedXPath | null {
  const unique = candidates.find((candidate) => candidate.count === 1);
  if (unique) {
    return { xpath: unique.xpath, successFlag: '成功' };
  }

  const matched = candidates.find((candidate) => candidate.count > 0);
  return matched
    ? { xpath: matched.xpath, successFlag: '多元素命中' }
    : null;
}
