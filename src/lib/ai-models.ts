export function supportsVisionModel(model: string) {
  return /glm[-_ ]?5\.3[-_ ]?flash|glm.*(?:4\.[156].*v|vision)|qwen.*(?:vl|vision)|gemini|claude.*(?:3|4)|gpt-(?:4o|4\.1|5)|vision/i.test(
    model,
  );
}
export function isGlmReasoning(model: string) {
  return /glm[-_ ]?5(?:\.|-|$)/i.test(model);
}
