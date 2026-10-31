import type { CitationSettings, ReferenceData } from './types';

export const defaultCitationSettings: CitationSettings = {
  markerSuperscript: true,
  bibliographyIndent: 'none',
  indentCharacters: 2,
  markerTemplate: '[{{number}}]',
  referenceTemplate:
    '[{{number}}] {{authors}}. {{title}}[{{type}}]. {{journal}}, {{year}}, {{volume}}({{issue}}): {{pages}}. {{doi}}',
};

export const citationPlaceholders = [
  ['number', '引用编号', '1、2、3'],
  ['authors', '作者', '超过三人保留前三人，接“等”或 et al.'],
  ['title', '文献标题', '文章或图书名称'],
  ['type', '文献类型', 'J 期刊 / M 图书 / D 学位论文 / C 会议 / EB/OL 网络 / Z 其他'],
  ['journal', '期刊或会议', '刊物名称'],
  ['year', '年份', '2026'],
  ['volume', '卷', '46'],
  ['issue', '期', '3'],
  ['pages', '页码', '35–44'],
  ['doi', 'DOI', '10.xxxx/xxxxx'],
  ['publisher', '出版社', '出版机构名称'],
] as const;

export function formatAuthors(authors: string) {
  const names = authors
    .split(/[;；]/)
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length <= 3) return authors.trim();
  const chinese = /[\u3400-\u9fff]/u.test(names[0]);
  return `${names.slice(0, 3).join('; ')}${chinese ? '，等' : ', et al.'}`;
}

export function formatCitation(template: string, reference: ReferenceData, number: number) {
  const labels = {
    journal: 'J',
    book: 'M',
    thesis: 'D',
    conference: 'C',
    web: 'EB/OL',
    other: 'Z',
  };
  const fields: Record<string, string> = {
    ...reference,
    authors: formatAuthors(reference.authors),
    type: labels[reference.type],
    number: String(number),
  };
  return template
    .replace(/\{\{([a-z]+)\}\}/g, (_, name: string) => fields[name] || '')
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/\s+([,.:;])/g, '$1')
    .replace(/([,.:;])\s*([,.:;])+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,.:;\s]+|[,;:\s]+$/g, '')
    .trim();
}
