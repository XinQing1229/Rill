import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown } from 'mdast-util-to-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm';
import type { Nodes, Root } from 'mdast';
import { type BookDiagnostic, type BookDocument } from '@rill/shared';
import { proseHash } from '../prose/prose-files.service.js';
export const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
function plain(n: Nodes): string {
  if (n.type === 'text' || n.type === 'inlineCode') return n.value;
  if (n.type === 'break') return '\n';
  if (n.type === 'thematicBreak') return '——';
  return 'children' in n
    ? n.children.map((c) => plain(c)).join(n.type === 'root' ? '\n\n' : '')
    : '';
}
function html(n: Nodes): string {
  if (n.type === 'text') return xml(n.value);
  if (n.type === 'break') return '<br/>';
  if (n.type === 'thematicBreak') return '<hr/>';
  const body = 'children' in n ? n.children.map((c) => html(c)).join('') : '';
  switch (n.type) {
    case 'paragraph':
      return `<p>${body}</p>`;
    case 'heading':
      return `<h${n.depth}>${body}</h${n.depth}>`;
    case 'emphasis':
      return `<em>${body}</em>`;
    case 'strong':
      return `<strong>${body}</strong>`;
    case 'link':
      return `<a href="${xml(n.url)}">${body}</a>`;
    default:
      return body;
  }
}
const allowed = new Set([
  'root',
  'paragraph',
  'heading',
  'text',
  'emphasis',
  'strong',
  'thematicBreak',
  'break',
  'link',
]);
export function prepareDocument(
  number: number,
  title: string,
  originalTitle: string,
  source: string,
): { document: BookDocument; diagnostics: BookDiagnostic[] } {
  const tree = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const diagnostics: BookDiagnostic[] = [];
  const issue = (node: Nodes, code: string, message: string) =>
    diagnostics.push({
      chapterNumber: number,
      code,
      message: `第 ${number} 章：${message}`,
      line: node.position?.start.line,
    });
  const visit = (node: Nodes) => {
    if (!allowed.has(node.type))
      issue(node, 'UNSUPPORTED_MARKDOWN', `暂不支持 ${node.type} 结构，请在本地处理`);
    if (node.type === 'link' && !/^(https?:|mailto:|#)/i.test(node.url))
      issue(node, 'UNSAFE_LINK', '链接协议不支持');
    if ('children' in node) node.children.forEach((c) => visit(c));
  };
  visit(tree);
  const first = tree.children[0];
  const normalize = (s: string) =>
    s.replace(/\s+/g, '').replace(new RegExp(`^第(?:${number}|${chineseNumber(number)})章`), '');
  if (first?.type === 'heading') {
    const heading = normalize(plain(first));
    if (!heading || [originalTitle, title].some((t) => normalize(t) === heading))
      tree.children.shift();
    else issue(first, 'AMBIGUOUS_TITLE', '章首标题与章名不匹配，请核对展示标题或本地正文');
  }
  return {
    document: {
      chapterNumber: number,
      title,
      source,
      sourceHash: proseHash(source),
      plain: plain(tree),
      markdown: toMarkdown(tree as Root, { extensions: [gfmToMarkdown()] }).trimEnd(),
      html: html(tree),
    },
    diagnostics,
  };
}
function chineseNumber(n: number): string {
  const digits = '零一二三四五六七八九';
  if (n < 10) return digits[n];
  if (n < 100)
    return (n >= 20 ? digits[Math.floor(n / 10)] : '') + '十' + (n % 10 ? digits[n % 10] : '');
  return String(n);
}
export function chapterHeading(n: number, title: string) {
  return /^第.+章$/.test(title) ? title : `第 ${n} 章 ${title}`;
}
