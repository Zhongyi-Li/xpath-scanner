export type ElementIdentity = {
  元素名称: string;
  元素类型: string;
  定位方式: string;
};

function identityKey(row: ElementIdentity): string {
  return `${row.元素名称}\u0000${row.元素类型}\u0000${row.定位方式}`;
}

export function excludeElementRows<T extends ElementIdentity>(
  rows: T[],
  excludedRows: ElementIdentity[],
): T[] {
  const excludedKeys = new Set(excludedRows.map(identityKey));
  return rows.filter((row) => !excludedKeys.has(identityKey(row)));
}
