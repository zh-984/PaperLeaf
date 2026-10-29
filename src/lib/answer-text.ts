/** Remove presentation-only Markdown markers while preserving mathematical symbols. */
export function cleanAnswerText(text: string) {
  return text
    .replace(/^\s*```[^\n]*\n?/gm, '')
    .replace(/^(\s*)#{1,6}\s+/gm, '$1')
    .replace(/^(\s*)>\s?/gm, '$1')
    .replace(/^(\s*)[-*+]\s+/gm, '$1')
    .replace(/\*{2,3}([^*\n]+?)\*{2,3}/g, '$1')
    .replace(/(^|[\s（(])\*([^*\n]+?)\*(?=$|[\s，。；：？！、）),.!?;:])/gm, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1（$2）');
}
