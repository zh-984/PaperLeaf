import { formatScientificText, scientificRuns } from '@/lib/citation';

export function ScientificText({ text }: { text: string }) {
  return scientificRuns(formatScientificText(text)).map((run, index) =>
    run.script === 'sub' ? (
      <sub key={index}>{run.text}</sub>
    ) : run.script === 'sup' ? (
      <sup key={index}>{run.text}</sup>
    ) : (
      <span key={index}>{run.text}</span>
    ),
  );
}
