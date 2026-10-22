// Ported from JoyoFit (watch-fit) src/features/ai/markdown/parse.test.ts, adapted for JoyoRogo.
import { describe, expect, test } from 'bun:test';

import { parseMarkdown, type Block, type Inline } from './parse';

const t = (s: string): Inline => ({ t: 'text', s });

function first(text: string, streaming = false): Block {
  const blocks = parseMarkdown(text, { streaming });
  expect(blocks.length).toBeGreaterThan(0);
  return blocks[0]!;
}

function inlineOf(text: string, streaming = false): Inline[] {
  const block = first(text, streaming);
  if (block.t !== 'p') throw new Error(`expected paragraph, got ${block.t}`);
  return block.c;
}

describe('blocks', () => {
  test('paragraphs split on blank lines and soft breaks become spaces', () => {
    expect(parseMarkdown('one\ntwo\n\nthree')).toEqual([
      { t: 'p', c: [t('one two')] },
      { t: 'p', c: [t('three')] },
    ]);
  });

  test('headings map levels 4 to 6 to 3 and need a space after the hashes', () => {
    expect(parseMarkdown('# A\n## B\n### C\n#### D\n###### E')).toEqual([
      { t: 'h', level: 1, c: [t('A')] },
      { t: 'h', level: 2, c: [t('B')] },
      { t: 'h', level: 3, c: [t('C')] },
      { t: 'h', level: 3, c: [t('D')] },
      { t: 'h', level: 3, c: [t('E')] },
    ]);
    expect(parseMarkdown('#tag')).toEqual([{ t: 'p', c: [t('#tag')] }]);
    expect(parseMarkdown('## Title ##')).toEqual([{ t: 'h', level: 2, c: [t('Title')] }]);
    expect(parseMarkdown('# C#')).toEqual([{ t: 'h', level: 1, c: [t('C#')] }]);
  });

  test('bullet lists with all three markers', () => {
    expect(parseMarkdown('- a\n* b\n+ c')).toEqual([
      {
        t: 'ul',
        items: [
          { c: [t('a')], depth: 0, n: null },
          { c: [t('b')], depth: 0, n: null },
          { c: [t('c')], depth: 0, n: null },
        ],
      },
    ]);
  });

  test('ordered list keeps its start number and counts on', () => {
    expect(parseMarkdown('3. a\n4. b\n1. c')).toEqual([
      {
        t: 'ol',
        start: 3,
        items: [
          { c: [t('a')], depth: 0, n: 3 },
          { c: [t('b')], depth: 0, n: 4 },
          { c: [t('c')], depth: 0, n: 5 },
        ],
      },
    ]);
    const ol = first('1) x\n2) y');
    expect(ol.t === 'ol' && ol.start).toBe(1);
  });

  test('nested lists are flattened with a depth, mixed kinds keep their own marker', () => {
    expect(parseMarkdown('1. a\n   - b\n   - c\n2. d\n    1. e')).toEqual([
      {
        t: 'ol',
        start: 1,
        items: [
          { c: [t('a')], depth: 0, n: 1 },
          { c: [t('b')], depth: 1, n: null },
          { c: [t('c')], depth: 1, n: null },
          { c: [t('d')], depth: 0, n: 2 },
          { c: [t('e')], depth: 1, n: 1 },
        ],
      },
    ]);
  });

  test('list item continuation lines join the item, blank lines inside a list keep it together', () => {
    expect(parseMarkdown('- one\n  more\n\n- two')).toEqual([
      {
        t: 'ul',
        items: [
          { c: [t('one more')], depth: 0, n: null },
          { c: [t('two')], depth: 0, n: null },
        ],
      },
    ]);
  });

  test('lists mixed with paragraphs', () => {
    const blocks = parseMarkdown('Intro:\n- a\n- b\n\nOutro\n\n1. x\n2. y');
    expect(blocks.map((b) => b.t)).toEqual(['p', 'ul', 'p', 'ol']);
    expect(blocks[0]).toEqual({ t: 'p', c: [t('Intro:')] });
  });

  test('a bullet list followed directly by an ordered list is two blocks', () => {
    expect(parseMarkdown('- a\n1. b').map((b) => b.t)).toEqual(['ul', 'ol']);
  });

  test('number-like text does not start a list', () => {
    expect(parseMarkdown('Tahun lalu\n2020. adalah')).toEqual([{ t: 'p', c: [t('Tahun lalu 2020. adalah')] }]);
    expect(parseMarkdown('3.5 km')).toEqual([{ t: 'p', c: [t('3.5 km')] }]);
  });

  test('fenced code keeps its text and language', () => {
    expect(parseMarkdown('```ts\nconst a = 1;\n\nb\n```\nafter')).toEqual([
      { t: 'code', lang: 'ts', text: 'const a = 1;\n\nb', open: false },
      { t: 'p', c: [t('after')] },
    ]);
    expect(parseMarkdown('~~~\nx\n~~~')).toEqual([{ t: 'code', lang: null, text: 'x', open: false }]);
  });

  test('markdown inside a fence stays literal, a longer fence needs a matching close', () => {
    expect(parseMarkdown('````\n```\n**x**\n```\n````')).toEqual([
      { t: 'code', lang: null, text: '```\n**x**\n```', open: false },
    ]);
  });

  test('blockquotes parse their content as blocks, with lazy continuation', () => {
    expect(parseMarkdown('> **hi**\n> - a\n> - b\nlazy')).toEqual([
      {
        t: 'quote',
        c: [
          { t: 'p', c: [{ t: 'bold', c: [t('hi')] }] },
          { t: 'ul', items: [{ c: [t('a')], depth: 0, n: null }, { c: [t('b lazy')], depth: 0, n: null }] },
        ],
      },
    ]);
  });

  test('nested quotes', () => {
    expect(parseMarkdown('> a\n>> b')).toEqual([
      { t: 'quote', c: [{ t: 'p', c: [t('a')] }, { t: 'quote', c: [{ t: 'p', c: [t('b')] }] }] },
    ]);
    const q = first('>> deep');
    expect(q.t === 'quote' && q.c[0]!.t).toBe('quote');
  });

  test('horizontal rules', () => {
    expect(parseMarkdown('---\n***\n___\n- - -')).toEqual([{ t: 'hr' }, { t: 'hr' }, { t: 'hr' }, { t: 'hr' }]);
    expect(parseMarkdown('a\n---\nb').map((b) => b.t)).toEqual(['p', 'hr', 'p']);
  });

  test('tables with an alignment row', () => {
    expect(parseMarkdown('| Hari | Menu | Kkal |\n|:--|:-:|--:|\n| Senin | Nasi | **500** |\n| Selasa | Roti | 300 |')).toEqual([
      {
        t: 'table',
        align: ['left', 'center', 'right'],
        head: [[t('Hari')], [t('Menu')], [t('Kkal')]],
        rows: [
          [[t('Senin')], [t('Nasi')], [{ t: 'bold', c: [t('500')] }]],
          [[t('Selasa')], [t('Roti')], [t('300')]],
        ],
      },
    ]);
  });

  test('tables without outer pipes and with escaped pipes', () => {
    const b = first('a | b\n--|--\n1 | x \\| y');
    expect(b).toEqual({
      t: 'table',
      align: [null, null],
      head: [[t('a')], [t('b')]],
      rows: [[[t('1')], [t('x | y')]]],
    });
  });

  test('rows with fewer cells are padded, rows with more keep the excess in the last cell', () => {
    const b = first('| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |');
    expect(b.t).toBe('table');
    if (b.t !== 'table') return;
    expect(b.rows[0]).toEqual([[t('1')], []]);
    expect(b.rows[1]).toEqual([[t('1')], [t('2|3|4')]]);
    for (const row of b.rows) expect(row.length).toBe(2);
  });

  test('a header line without a delimiter row is a paragraph', () => {
    expect(parseMarkdown('| a | b |')).toEqual([{ t: 'p', c: [t('| a | b |')] }]);
  });

  test('a table ends at a blank line and a paragraph may precede it without a blank', () => {
    const blocks = parseMarkdown('Tabel:\n| a |\n|---|\n| 1 |\n\nSetelah');
    expect(blocks.map((b) => b.t)).toEqual(['p', 'table', 'p']);
  });

  test('hard line breaks: two spaces and backslash', () => {
    expect(inlineOf('a  \nb')).toEqual([t('a'), { t: 'br' }, t('b')]);
    expect(inlineOf('a\\\nb')).toEqual([t('a'), { t: 'br' }, t('b')]);
  });
});

describe('inlines', () => {
  test('bold and italic with both marker kinds', () => {
    expect(inlineOf('**a** __b__ *c* _d_')).toEqual([
      { t: 'bold', c: [t('a')] },
      t(' '),
      { t: 'bold', c: [t('b')] },
      t(' '),
      { t: 'italic', c: [t('c')] },
      t(' '),
      { t: 'italic', c: [t('d')] },
    ]);
  });

  test('bold containing code, italic inside bold, and bold italic', () => {
    expect(inlineOf('**run `5 km` now**')).toEqual([{ t: 'bold', c: [t('run '), { t: 'code', s: '5 km' }, t(' now')] }]);
    expect(inlineOf('**a *b* c**')).toEqual([{ t: 'bold', c: [t('a '), { t: 'italic', c: [t('b')] }, t(' c')] }]);
    expect(inlineOf('***x***')).toEqual([{ t: 'italic', c: [{ t: 'bold', c: [t('x')] }] }]);
  });

  test('italic inside list items', () => {
    const b = first('- *pelan* saja\n- _santai_');
    expect(b).toEqual({
      t: 'ul',
      items: [
        { c: [{ t: 'italic', c: [t('pelan')] }, t(' saja')], depth: 0, n: null },
        { c: [{ t: 'italic', c: [t('santai')] }], depth: 0, n: null },
      ],
    });
  });

  test('snake_case, 2*3*4 and spaced stars stay text', () => {
    expect(inlineOf('snake_case_name')).toEqual([t('snake_case_name')]);
    expect(inlineOf('2*3*4')).toEqual([t('2*3*4')]);
    expect(inlineOf('a * b * c')).toEqual([t('a * b * c')]);
    expect(inlineOf('__init__ is dunder', false)).toEqual([{ t: 'bold', c: [t('init')] }, t(' is dunder')]);
    expect(inlineOf('file_name.txt and other_file.txt')).toEqual([t('file_name.txt and other_file.txt')]);
  });

  test('inline code keeps markup literal and strips one padding space', () => {
    expect(inlineOf('`**x**` and `` a`b ``')).toEqual([{ t: 'code', s: '**x**' }, t(' and '), { t: 'code', s: 'a`b' }]);
  });

  test('backslash escapes', () => {
    expect(inlineOf('\\*not\\* \\_x\\_ \\a')).toEqual([t('*not* _x_ \\a')]);
  });

  test('links accept http, https and mailto only', () => {
    expect(inlineOf('[Docs](https://example.com/a?b=1) dan [Mail](mailto:a@b.co)')).toEqual([
      { t: 'link', href: 'https://example.com/a?b=1', c: [t('Docs')] },
      t(' dan '),
      { t: 'link', href: 'mailto:a@b.co', c: [t('Mail')] },
    ]);
    expect(inlineOf('[**b**](http://x.io)')).toEqual([{ t: 'link', href: 'http://x.io', c: [{ t: 'bold', c: [t('b')] }] }]);
  });

  test('unsafe or odd link schemes become plain text', () => {
    for (const bad of ['[x](javascript:alert(1))', '[x](data:text/html,hi)', '[x](JAVASCRIPT:foo)', '[x](/relative)', '[x](ftp://a.b)']) {
      const nodes = inlineOf(bad);
      expect(nodes.every((n) => n.t === 'text')).toBe(true);
      expect(nodes.map((n) => (n.t === 'text' ? n.s : '')).join('')).toBe(bad);
    }
  });

  test('a link destination with a space is not a link', () => {
    expect(inlineOf('[x](http://a b)').some((n) => n.t === 'link' && n.href.includes(' '))).toBe(false);
  });

  test('bare URLs become links without trailing punctuation', () => {
    expect(inlineOf('lihat https://example.com/x, ya')).toEqual([
      t('lihat '),
      { t: 'link', href: 'https://example.com/x', c: [t('https://example.com/x')] },
      t(', ya'),
    ]);
    expect(inlineOf('(https://a.io/p_(q))')).toEqual([
      t('('),
      { t: 'link', href: 'https://a.io/p_(q)', c: [t('https://a.io/p_(q)')] },
      t(')'),
    ]);
  });

  test('raw HTML stays literal text', () => {
    expect(inlineOf('<b>hi</b> <script>x</script>')).toEqual([t('<b>hi</b> <script>x</script>')]);
  });

  test('CRLF and lone CR line endings', () => {
    expect(parseMarkdown('# A\r\n\r\n- x\r\n- y\r\n')).toEqual([
      { t: 'h', level: 1, c: [t('A')] },
      { t: 'ul', items: [{ c: [t('x')], depth: 0, n: null }, { c: [t('y')], depth: 0, n: null }] },
    ]);
    expect(parseMarkdown('a\rb')).toEqual([{ t: 'p', c: [t('a b')] }]);
  });

  test('empty and whitespace-only input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('   \n\t\n  ')).toEqual([]);
  });
});

describe('streaming partial input', () => {
  test('unclosed bold is literal when final and emphasis so far while streaming', () => {
    expect(inlineOf('Makan **protein')).toEqual([t('Makan **protein')]);
    expect(inlineOf('Makan **protein', true)).toEqual([t('Makan '), { t: 'bold', c: [t('protein')] }]);
    expect(inlineOf('a *itali', true)).toEqual([t('a '), { t: 'italic', c: [t('itali')] }]);
    expect(inlineOf('**a *b', true)).toEqual([{ t: 'bold', c: [t('a '), { t: 'italic', c: [t('b')] }] }]);
  });

  test('a lone trailing marker never disappears', () => {
    expect(inlineOf('Makan **', true)).toEqual([t('Makan **')]);
    expect(inlineOf('Makan *', true)).toEqual([t('Makan *')]);
  });

  test('only the last block is treated as partial', () => {
    const blocks = parseMarkdown('first **open\n\nsecond **open', { streaming: true });
    expect(blocks[0]).toEqual({ t: 'p', c: [t('first **open')] });
    expect(blocks[1]).toEqual({ t: 'p', c: [t('second '), { t: 'bold', c: [t('open')] }] });
  });

  test('unclosed fence is open and keeps its text', () => {
    expect(parseMarkdown('```js\nconst a')).toEqual([{ t: 'code', lang: 'js', text: 'const a', open: true }]);
    expect(parseMarkdown('```js\nconst a\n')).toEqual([{ t: 'code', lang: 'js', text: 'const a', open: true }]);
    expect(parseMarkdown('```')).toEqual([{ t: 'code', lang: null, text: '', open: true }]);
    expect(parseMarkdown('text\n\n```\nx')[1]).toEqual({ t: 'code', lang: null, text: 'x', open: true });
  });

  test('a closing fence still being typed is not code text', () => {
    expect(parseMarkdown('```\nx\n``', { streaming: true })).toEqual([{ t: 'code', lang: null, text: 'x', open: true }]);
  });

  test('unclosed backtick span', () => {
    expect(inlineOf('run `5 k')).toEqual([t('run `5 k')]);
    expect(inlineOf('run `5 k', true)).toEqual([t('run '), { t: 'code', s: '5 k' }]);
  });

  test('half a link keeps every character', () => {
    for (const partial of ['[Docs', '[Docs]', '[Docs](', '[Docs](http', '[Docs](https://exa']) {
      const nodes = inlineOf(partial, true);
      const visible = nodes.map((n) => (n.t === 'text' ? n.s : n.t === 'link' ? n.c.map((x) => (x.t === 'text' ? x.s : '')).join('') : '')).join('');
      expect(visible.replace(/[^A-Za-z]/g, '')).toBe(partial.replace(/[^A-Za-z]/g, ''));
      expect(nodes.some((n) => n.t === 'link' && n.href.startsWith('javascript'))).toBe(false);
    }
    expect(inlineOf('[Docs](http')).toEqual([t('[Docs](http')]);
  });

  test('half a table row is padded; a delimiter row still being typed starts the table', () => {
    const b = first('| a | b |\n|---|---|\n| 1 | 2 |\n| 3', true);
    expect(b.t).toBe('table');
    if (b.t !== 'table') return;
    expect(b.rows[1]).toEqual([[t('3')], []]);
    const early = first('| a | b | c |\n|---', true);
    expect(early.t).toBe('table');
    expect(first('| a | b | c |\n|---').t).toBe('p');
  });

  test('a half-typed bullet or heading marker', () => {
    expect(parseMarkdown('Daftar\n-')).toEqual([{ t: 'p', c: [t('Daftar -')] }]);
    expect(parseMarkdown('##')).toEqual([{ t: 'h', level: 2, c: [] }]);
    expect(parseMarkdown('- a\n- **b', { streaming: true })).toEqual([
      { t: 'ul', items: [{ c: [t('a')], depth: 0, n: null }, { c: [{ t: 'bold', c: [t('b')] }], depth: 0, n: null }] },
    ]);
  });
});

describe('real answers', () => {
  test('an Indonesian coach answer', () => {
    const answer = [
      '## Ringkasan minggu ini',
      '',
      'Kamu sudah berlari **3 kali** dan tidur rata-rata *6 jam 40 menit*.',
      '',
      '### Yang perlu diperhatikan',
      '- **Tidur:** tambah 30 menit, targetkan sebelum jam 22.00',
      '- **Lari:** pertahankan pace `6:10/km` di hari easy',
      '- **Nutrisi:** minum air putih minimal 2 liter',
      '',
      '| Hari | Latihan | Durasi |',
      '|:-----|:-------:|-------:|',
      '| Senin | Easy run | 40 mnt |',
      '| Kamis | Interval | 35 mnt |',
      '',
      '1. Pemanasan 10 menit',
      '2. Inti latihan',
      '3. Pendinginan',
      '',
      '_Ini bukan nasihat medis. Konsultasikan dengan dokter bila ada keluhan._',
    ].join('\n');
    const blocks = parseMarkdown(answer);
    expect(blocks.map((b) => b.t)).toEqual(['h', 'p', 'h', 'ul', 'table', 'ol', 'p']);
    const ul = blocks[3]!;
    if (ul.t !== 'ul') throw new Error('ul');
    expect(ul.items[0]!.c[0]).toEqual({ t: 'bold', c: [t('Tidur:')] });
    expect(ul.items[1]!.c).toContainEqual({ t: 'code', s: '6:10/km' });
    const table = blocks[4]!;
    if (table.t !== 'table') throw new Error('table');
    expect(table.align).toEqual(['left', 'center', 'right']);
    expect(table.rows.length).toBe(2);
    const last = blocks[6]!;
    expect(last.t === 'p' && last.c[0]!.t).toBe('italic');
  });
});

describe('robustness', () => {
  test('pathological inputs finish quickly', () => {
    const cases = [
      '*'.repeat(20000),
      '_'.repeat(20000),
      '['.repeat(20000),
      '[a]('.repeat(5000),
      '[a](x'.repeat(4000),
      ']['.repeat(10000),
      '`'.repeat(20000),
      '` '.repeat(10000),
      '``` ``'.repeat(3000),
      '*a '.repeat(6000),
      '*a_ '.repeat(5000),
      '**_'.repeat(6000),
      'a*'.repeat(10000),
      '>'.repeat(20000),
      '> '.repeat(10000),
      '- '.repeat(10000),
      '-\n'.repeat(10000),
      '  - a\n'.repeat(3000) + '- b\n'.repeat(3000),
      '|a|'.repeat(5000),
      '| a | b |\n|---|---|\n'.repeat(1000),
      '|\n'.repeat(10000),
      '\\'.repeat(20000),
      'https://'.repeat(3000),
      '# '.repeat(10000),
      '1. '.repeat(6000),
      '\n'.repeat(20000),
      ' '.repeat(20000) + 'x',
      '[' + '*'.repeat(5000) + '](http://x)',
      '(' .repeat(5000) + '[a](http://' + '('.repeat(5000),
    ];
    for (const input of cases) {
      for (const streaming of [false, true]) {
        const start = performance.now();
        parseMarkdown(input, { streaming });
        expect(performance.now() - start).toBeLessThan(1000);
      }
    }
  });

  test('a 20,000 character realistic answer parses in well under a frame budget', () => {
    const para = 'Kamu **sudah** berlari _cukup_ baik, lihat [data](https://example.com/x) dan `pace 6:10`. ';
    const text = (`- ${para}\n` + `\n${para}\n\n| a | b |\n|---|---|\n| 1 | **2** |\n\n`).repeat(100);
    expect(text.length).toBeGreaterThan(20000);
    const start = performance.now();
    parseMarkdown(text);
    expect(performance.now() - start).toBeLessThan(250);
  });

  test('deep list indentation is clamped', () => {
    const text = Array.from({ length: 30 }, (_, k) => `${' '.repeat(k * 2)}- x`).join('\n');
    const b = first(text);
    expect(b.t).toBe('ul');
    if (b.t !== 'ul') return;
    expect(Math.max(...b.items.map((i) => i.depth))).toBeLessThanOrEqual(4);
    expect(b.items.length).toBe(30);
  });

  test('non-string input does not throw', () => {
    expect(parseMarkdown(undefined as unknown as string)).toEqual([]);
    expect(parseMarkdown(null as unknown as string)).toEqual([]);
  });
});

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text':
        case 'code':
          return n.s;
        case 'bold':
        case 'italic':
          return inlineText(n.c);
        case 'link': {
          const label = inlineText(n.c);
          return label === n.href ? label : label + n.href;
        }
        case 'br':
          return '';
      }
    })
    .join('');
}

function blockText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.t) {
        case 'p':
        case 'h':
          return inlineText(b.c);
        case 'ul':
        case 'ol':
          return b.items.map((i) => inlineText(i.c)).join('');
        case 'code':
          return (b.lang ?? '') + b.text;
        case 'quote':
          return blockText(b.c);
        case 'table':
          return [...b.head, ...b.rows.flat()].map(inlineText).join('');
        case 'hr':
          return '';
      }
    })
    .join('');
}

const letters = (s: string) => s.replace(/[^A-Za-z]/g, '').split('').sort().join('');

describe('property', () => {
  const alphabet = 'abcdefgh xyz  \n\n*_*_[]()`|-:#>1.+~\\!h/ttp:';
  test('never throws and keeps every letter of 200 random strings', () => {
    const next = rng(20240607);
    for (let round = 0; round < 200; round++) {
      const length = Math.floor(next() * 120);
      let input = '';
      for (let k = 0; k < length; k++) input += alphabet[Math.floor(next() * alphabet.length)];
      for (const streaming of [false, true]) {
        const blocks = parseMarkdown(input, { streaming });
        expect({ input, streaming, letters: letters(blockText(blocks)) }).toEqual({ input, streaming, letters: letters(input) });
      }
    }
  });

  test('random printable ASCII never throws', () => {
    const next = rng(7);
    for (let round = 0; round < 200; round++) {
      const length = Math.floor(next() * 300);
      let input = '';
      for (let k = 0; k < length; k++) input += String.fromCharCode(next() < 0.1 ? 10 : 32 + Math.floor(next() * 95));
      expect(() => parseMarkdown(input)).not.toThrow();
      expect(() => parseMarkdown(input, { streaming: true })).not.toThrow();
    }
  });

  test('every prefix of a long answer parses (streaming replay)', () => {
    const answer = '## Judul\n\n- **a:** `x`\n- [l](https://e.io) *i*\n\n| a | b |\n|:-|-:|\n| 1 | 2 |\n\n```js\nlet a;\n```\n> kutipan **tebal**\n1. satu\n2. dua\n';
    for (let k = 0; k <= answer.length; k++) {
      expect(() => parseMarkdown(answer.slice(0, k), { streaming: true })).not.toThrow();
    }
  });
});
