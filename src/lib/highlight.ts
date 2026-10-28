import { normalizeEvidence } from './chunks';
export function highlightQuote(container: HTMLElement, quote: string, scroll = true): boolean {
  container
    .querySelectorAll('.evidence-highlight')
    .forEach((span) => span.classList.remove('evidence-highlight'));
  const needle = normalizeEvidence(quote);
  if (needle.length < 4) return false;
  const spans = Array.from(container.querySelectorAll<HTMLSpanElement>('span')).filter(
    (span) => !span.classList.contains('markedContent'),
  );
  const parts = spans.map((span) => normalizeEvidence(span.textContent || ''));
  const index = parts.join('').indexOf(needle);
  if (index < 0) return false;
  let offset = 0;
  let first: HTMLElement | undefined;
  spans.forEach((span, i) => {
    const end = offset + parts[i].length;
    if (end > index && offset < index + needle.length) {
      span.classList.add('evidence-highlight');
      first ??= span;
    }
    offset = end;
  });
  if (scroll) first?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  return Boolean(first);
}
