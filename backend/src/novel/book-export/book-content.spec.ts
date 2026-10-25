import { unzipSync, strFromU8 } from 'fflate';
import {
  BookFormatsSchema,
  SaveBookSettingsSchema,
  ProseChapterParamSchema,
  STAGES,
} from '@rill/shared';
import { prepareDocument } from './book-content.js';
import { renderBook } from './book-renderers.js';
const meta = { title: '雪 & 信', author: '', introduction: '简介 <留存>', chapterTitles: [] };
describe('书本交付契约与内容转换', () => {
  it('拒绝非法格式、重复格式、空书名与非法章号，不改变流水线', () => {
    for (const f of [[], ['txt', 'txt'], ['pdf']])
      expect(BookFormatsSchema.safeParse(f).success).toBe(false);
    expect(
      SaveBookSettingsSchema.safeParse({ ...meta, title: ' ', expectedRevision: 0 }).success,
    ).toBe(false);
    for (const n of ['0', '-1', '1.5', 'NaN'])
      expect(ProseChapterParamSchema.safeParse(n).success).toBe(false);
    expect(STAGES.at(-1)).toBe('prose');
  });
  it.each(['# 信\n\n你好 **世界**。', '# 第一章 信\n\n你好 **世界**。', '你好 **世界**。'])(
    '标题整理保留段落并去重 %s',
    (source) => {
      const { document: d, diagnostics } = prepareDocument(1, '信', '信', source);
      expect(diagnostics).toEqual([]);
      expect(d.plain).toBe('你好 世界。');
      expect(d.html).toContain('<strong>世界</strong>');
      expect(d.source).toBe(source);
    },
  );
  it('保守处理不同标题，保留正文小标题', () => {
    expect(prepareDocument(1, '信', '信', '# 陌生标题\n\n正文').diagnostics[0].code).toBe(
      'AMBIGUOUS_TITLE',
    );
    expect(
      prepareDocument(1, '新信', '信', '# 信\n\n正文\n\n## 插叙\n\n往事').document.markdown,
    ).toContain('## 插叙');
  });
  it.each([
    '![图](https://example.com/a.png)',
    '<script>alert(1)</script>',
    '| A | B |\n|---|---|\n| 1 | 2 |',
    '```js\na()\n```',
    '[危险](javascript:alert)',
  ])('不支持结构被定位且不丢原文 %s', (source) => {
    const p = prepareDocument(1, '信', '信', source);
    expect(p.diagnostics.length).toBeGreaterThan(0);
    expect(p.diagnostics[0].line).toBe(1);
    expect(p.document.source).toBe(source);
  });
  it('三种格式同序，EPUB 导航、XML 与 ZIP 结构有效', async () => {
    const docs = [1, 2].map(
      (n) => prepareDocument(n, '信', '信', '# 信\n\n你好 **世界**。\n\n第二段。').document,
    );
    const txt = (await renderBook('txt', meta, docs, 'a'.repeat(64))).toString();
    expect(txt).toContain('目录\n\n第 1 章 信\n第 2 章 信');
    expect(txt).not.toContain('**');
    const md = (await renderBook('markdown', meta, docs, 'a'.repeat(64))).toString();
    expect(md).toContain('(#chapter-2)');
    expect(md).toContain('<a id="chapter-2"></a>');
    expect(md).toContain('**世界**');
    const epub = await renderBook('epub', meta, docs, 'a'.repeat(64));
    expect(epub.readUInt16LE(8)).toBe(0);
    expect(epub.subarray(30, 38).toString()).toBe('mimetype');
    const zip = unzipSync(epub);
    const opf = strFromU8(zip['OEBPS/content.opf']);
    expect(opf).toContain('雪 &amp; 信');
    expect(opf).not.toContain('dc:creator');
    expect(opf.indexOf('idref="c1"')).toBeLessThan(opf.indexOf('idref="c2"'));
    expect(strFromU8(zip['OEBPS/nav.xhtml'])).toContain('chapter-2.xhtml');
    expect(strFromU8(zip['OEBPS/chapter-1.xhtml'])).toContain('<strong>世界</strong>');
  });
});
