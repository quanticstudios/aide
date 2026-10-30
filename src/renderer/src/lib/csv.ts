import type { Element, ElementContent } from 'hast'

function textOf(node: ElementContent): string {
  if (node.type === 'text') return node.value
  return node.type === 'element' ? node.children.map(textOf).join('') : ''
}

/** Reads a rendered table's header and body rows as the plain text of each cell. */
export function tableRows(table: Element): string[][] {
  return table.children.flatMap((section) =>
    section.type !== 'element'
      ? []
      : (section.tagName === 'tr' ? [section] : section.children).flatMap(
          (row) =>
            row.type === 'element' && row.tagName === 'tr'
              ? [
                  row.children
                    .filter((cell) => cell.type === 'element')
                    .map(textOf),
                ]
              : [],
        ),
  )
}

/** Formats rows as RFC 4180 CSV, quoting cells that hold a comma, quote or line break. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) =>
      row
        .map((cell) =>
          /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell,
        )
        .join(','),
    )
    .join('\r\n')
}
