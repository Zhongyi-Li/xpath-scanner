const DEFAULT_EXCEL_COLUMN_WIDTH_PX = 64;
const OUTPUT_COLUMN_WIDTH_MULTIPLIER = 3;

export function buildOutputColumnWidths(columnCount: number): Array<{ wpx: number }> {
  const width = DEFAULT_EXCEL_COLUMN_WIDTH_PX * OUTPUT_COLUMN_WIDTH_MULTIPLIER;
  return Array.from({ length: columnCount }, () => ({ wpx: width }));
}
