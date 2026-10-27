import { zip, strToU8, type Zippable } from 'fflate';
import type { BookDocument, BookFormat, BookMetadata } from '@rill/shared';
import { xml, chapterHeading } from './book-content.js';
export const BOOK_MIME: Record<BookFormat, string> = {
  txt: 'text/plain; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  epub: 'application/epub+zip',
};
export const BOOK_EXTENSION: Record<BookFormat, string> = {
  txt: 'txt',
  markdown: 'md',
  epub: 'epub',
};
const escapeMd = (s: string) => s.replace(/[\\`*_{}[\]()#+.!<>-]/g, '\\$&');
export async function renderBook(
  format: BookFormat,
  metadata: BookMetadata,
  chapters: BookDocument[],
  fingerprint: string,
  cover?: { data: Buffer; mimeType: 'image/jpeg' | 'image/png' },
): Promise<Buffer> {
  const heads = chapters.map((c) => chapterHeading(c.chapterNumber, c.title));
  if (format === 'txt')
    return Buffer.from(
      [
        metadata.title,
        metadata.author && `作者：${metadata.author}`,
        metadata.introduction,
        '目录\n\n' + heads.join('\n'),
        ...chapters.map((c, i) => `${heads[i]}\n\n${c.plain}`),
      ]
        .filter(Boolean)
        .join('\n\n') + '\n',
    );
  if (format === 'markdown')
    return Buffer.from(
      [
        `# ${escapeMd(metadata.title)}`,
        metadata.author && `作者：${escapeMd(metadata.author)}`,
        metadata.introduction && metadata.introduction.split('\n').map(escapeMd).join('\n'),
        '## 目录\n\n' +
          chapters
            .map((c, i) => `- [${escapeMd(heads[i])}](#chapter-${c.chapterNumber})`)
            .join('\n'),
        ...chapters.map(
          (c, i) =>
            `<a id="chapter-${c.chapterNumber}"></a>\n\n## ${escapeMd(heads[i])}\n\n${c.markdown}`,
        ),
      ]
        .filter(Boolean)
        .join('\n\n') + '\n',
    );
  const xhtml = (title: string, body: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN" xml:lang="zh-CN"><head><title>${xml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${body}</body></html>`;
  const nav = chapters
    .map((c, i) => `<li><a href="chapter-${c.chapterNumber}.xhtml">${xml(heads[i])}</a></li>`)
    .join('');
  const files: Zippable = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
  };
  const coverName = cover?.mimeType === 'image/jpeg' ? 'cover.jpg' : 'cover.png';
  if (cover) {
    files[`OEBPS/${coverName}`] = cover.data;
    files['OEBPS/cover.xhtml'] = strToU8(
      xhtml(
        '封面',
        `<div style="text-align:center"><img src="${coverName}" alt="封面" style="max-width:100%;max-height:100%;object-fit:contain"/></div>`,
      ),
    );
  }
  files['OEBPS/title.xhtml'] = strToU8(
    xhtml(
      metadata.title,
      `<h1>${xml(metadata.title)}</h1>${metadata.author ? `<p>${xml(metadata.author)}</p>` : ''}${
        metadata.introduction
          ? metadata.introduction
              .split(/\n+/)
              .map((p) => `<p>${xml(p)}</p>`)
              .join('')
          : ''
      }`,
    ),
  );
  files['OEBPS/nav.xhtml'] = strToU8(
    xhtml('目录', `<nav epub:type="toc" id="toc"><h1>目录</h1><ol>${nav}</ol></nav>`),
  );
  files['OEBPS/style.css'] = strToU8(
    'body { line-height: 1.7; } p { text-indent: 2em; } h1 { break-before: page; page-break-before: always; }',
  );
  chapters.forEach((c, i) => {
    files[`OEBPS/chapter-${c.chapterNumber}.xhtml`] = strToU8(
      xhtml(heads[i], `<h1>${xml(heads[i])}</h1>${c.html}`),
    );
  });
  files['OEBPS/content.opf'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="zh-CN"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">urn:sha256:${fingerprint}</dc:identifier><dc:title>${xml(metadata.title)}</dc:title><dc:language>zh-CN</dc:language>${metadata.author ? `<dc:creator>${xml(metadata.author)}</dc:creator>` : ''}${metadata.introduction ? `<dc:description>${xml(metadata.introduction)}</dc:description>` : ''}<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta></metadata><manifest>${cover ? `<item id="cover-image" href="${coverName}" media-type="${cover.mimeType}" properties="cover-image"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>` : ''}<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="style" href="style.css" media-type="text/css"/>${chapters.map((c) => `<item id="c${c.chapterNumber}" href="chapter-${c.chapterNumber}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${cover ? '<itemref idref="cover-page"/>' : ''}<itemref idref="title"/><itemref idref="nav"/>${chapters.map((c) => `<itemref idref="c${c.chapterNumber}"/>`).join('')}</spine></package>`,
  );
  return new Promise((resolve, reject) =>
    zip(files, { level: 6 }, (error, data) => (error ? reject(error) : resolve(Buffer.from(data)))),
  );
}
