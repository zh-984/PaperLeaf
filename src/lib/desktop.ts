declare global {
  interface Window {
    paperleafDesktop?: {
      action: (name: string) => Promise<void>;
      word: (input: unknown) => Promise<{ citations: number; references: number }>;
    };
  }
}
export async function desktopAction(action: string) {
  if (!window.paperleafDesktop) throw new Error('此功能仅在桌面版可用');
  await window.paperleafDesktop.action(action);
}
