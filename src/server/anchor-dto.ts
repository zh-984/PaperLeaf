import { parseAnchor } from '@/lib/anchors';
export function anchoredDto<T extends { anchorJson: string }>(record: T) {
  const { anchorJson, ...rest } = record;
  return { ...rest, anchor: parseAnchor(anchorJson) };
}
