import type { Element, ElementContent } from 'hast'
import { describe, expect, it } from 'vitest'

import { tableRows, toCsv } from './csv'

describe('toCsv', () => {
  it('joins plain cells with commas and rows with CRLF', () => {
    expect(
      toCsv([
        ['a', 'b'],
        ['1', '2'],
      ]),
    ).toBe('a,b\r\n1,2')
  })

  it('quotes cells with commas, quotes and line breaks', () => {
    expect(toCsv([['x, y', 'say "hi"', 'one\ntwo', 'cr\r']])).toBe(
      '"x, y","say ""hi""","one\ntwo","cr\r"',
    )
  })

  it('leaves pipes and empty cells unquoted', () => {
    expect(toCsv([['a | b', '', '|']])).toBe('a | b,,|')
  })
})

function element(tagName: string, children: ElementContent[]): Element {
  return { children, properties: {}, tagName, type: 'element' }
}

function text(value: string): ElementContent {
  return { type: 'text', value }
}

describe('tableRows', () => {
  it('reads header and body cells as plain text, skipping whitespace nodes', () => {
    const table = element('table', [
      text('\n'),
      element('thead', [
        element('tr', [
          element('th', [text('name')]),
          element('th', [text('value')]),
        ]),
      ]),
      element('tbody', [
        text('\n'),
        element('tr', [
          text('\n'),
          element('td', [element('code', [text('a | b')])]),
          element('td', [text('1, '), element('strong', [text('2')])]),
        ]),
      ]),
    ])
    expect(tableRows(table)).toEqual([
      ['name', 'value'],
      ['a | b', '1, 2'],
    ])
    expect(toCsv(tableRows(table))).toBe('name,value\r\na | b,"1, 2"')
  })
})
