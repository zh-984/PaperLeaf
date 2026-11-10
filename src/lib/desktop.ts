declare global {
  interface Window {
    paperleafDesktop?: {
      action: (name: string) => Promise<void>;
      word: (input: unknown) => Promise<{ citations: number; references: number }>;
      update?: (action: 'status' | 'check' | 'open') => Promise<UpdateState>;
    };
  }
}
export interface UpdateState {
  status: 'available' | 'current' | 'error';
  currentVersion: string;
  latestVersion: string;
  notes: string;
  url: string;
  error?: string;
}
export async function desktopAction(action: string) {
  if (!window.paperleafDesktop) throw new Error('此功能仅在桌面版可用');
  await window.paperleafDesktop.action(action);
}
