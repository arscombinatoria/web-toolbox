import stringWidth from 'string-width';
import type { ColumnAlignment, MarkdownOptions, TableData } from './logic';

export const MAX_PADDED_MARKDOWN_LENGTH = 1_000_000;

function visualWidth(value: string): number {
  // Measure canonical pairs alike and zero-width marks correctly without changing exported source.
  const measured = value.normalize('NFC').replace(/[\p{Mn}\p{Me}]/gu, mark =>
    mark === '\uFE0E' || mark === '\uFE0F' || mark === '\u20E3' ? mark : '');
  return stringWidth(measured);
}

function escapeCell(cell: string): string {
  return cell
    .replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
    // Keep literal tags and code delimiters safe; encode actual cell newlines as <br>.
    .replace(/`/g, '\\`').replace(/<(?=br(?:>|\/>| \/>))/gi, '\\<')
    .replace(/\r\n|\r|\n/g, '<br>');
}

function normalizeAlignment(alignment: ColumnAlignment | undefined): ColumnAlignment {
  return alignment === 'left' || alignment === 'center' || alignment === 'right' ? alignment : 'none';
}

function separator(alignment: ColumnAlignment, width: number): string {
  const colons = alignment === 'center' ? 2 : alignment === 'none' ? 0 : 1;
  const hyphens = Math.max(3, width - colons);
  return `${alignment === 'left' || alignment === 'center' ? ':' : ''}${'-'.repeat(hyphens)}${alignment === 'right' || alignment === 'center' ? ':' : ''}`;
}

function paddedCell(value: string, measuredWidth: number, targetWidth: number, alignment: ColumnAlignment): string {
  const extra = Math.max(0, targetWidth - measuredWidth);
  if (!extra) return value;
  if (alignment === 'right') return `${' '.repeat(extra)}${value}`;
  if (alignment === 'center') {
    const left = Math.floor(extra / 2);
    return `${' '.repeat(left)}${value}${' '.repeat(extra - left)}`;
  }
  return `${value}${' '.repeat(extra)}`;
}

export function formatMarkdown(table: TableData, options: MarkdownOptions = {}): string {
  if (!table.rows.length) return '';
  const cells = table.rows.map(row => row.map(escapeCell));
  const alignments = cells[0]!.map((_, index) => normalizeAlignment(options.alignments?.[index]));
  if (!options.padding) {
    const rows = cells.map(row => `| ${row.join(' | ')} |`);
    rows.splice(1, 0, `| ${alignments.map(alignment => separator(alignment, 3)).join(' | ')} |`);
    return rows.join('\n');
  }

  const measuredWidths = cells.map(row => row.map(visualWidth));
  const widths = cells[0]!.map((_, column) => {
    let width = 3 + (alignments[column] === 'none' ? 0 : alignments[column] === 'center' ? 2 : 1);
    for (const row of measuredWidths) width = Math.max(width, row[column]!);
    return width;
  });

  // Calculate the complete UTF-16 output length before allocating any padding strings.
  let estimatedLength = 0;
  const addWithinLimit = (length: number) => {
    estimatedLength += length;
    if (estimatedLength > MAX_PADDED_MARKDOWN_LENGTH) {
      throw new Error(`列幅調整後のMarkdownが安全上限（${MAX_PADDED_MARKDOWN_LENGTH.toLocaleString()} UTF-16文字）を超えます。列幅調整をオフにしてください。`);
    }
  };
  const rowDecorationLength = 4 + Math.max(0, widths.length - 1) * 3;
  for (const [rowIndex, row] of cells.entries()) {
    addWithinLimit(rowDecorationLength);
    for (const [column, value] of row.entries()) {
      addWithinLimit(value.length + Math.max(0, widths[column]! - measuredWidths[rowIndex]![column]!));
    }
    addWithinLimit(1);
  }
  addWithinLimit(rowDecorationLength);
  for (const width of widths) addWithinLimit(width);

  const encodedSeparators = widths.map((width, column) => separator(alignments[column]!, width));

  const rows = cells.map((row, rowIndex) => `| ${row.map((value, column) => paddedCell(value, measuredWidths[rowIndex]![column]!, widths[column]!, alignments[column]!)).join(' | ')} |`);
  rows.splice(1, 0, `| ${encodedSeparators.join(' | ')} |`);
  const result = rows.join('\n');
  if (result.length > MAX_PADDED_MARKDOWN_LENGTH) {
    throw new Error(`列幅調整後のMarkdownが安全上限（${MAX_PADDED_MARKDOWN_LENGTH.toLocaleString()} UTF-16文字）を超えます。列幅調整をオフにしてください。`);
  }
  return result;
}
