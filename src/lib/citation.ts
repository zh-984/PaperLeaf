import type { CitationSettings, ReferenceData } from './types';

export const defaultCitationSettings: CitationSettings = {
  markerTemplate: '[{{number}}]',
  referenceTemplate:
    '[{{number}}] {{authors}}. {{title}}[{{type}}]. {{journal}}, {{year}}, {{volume}}({{issue}}): {{pages}}. {{doi}}',
};

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
