import { defaultPreferences, type AppPreferences } from '@/lib/types';
import { db } from './db';
export async function getPreferences(): Promise<AppPreferences> {
  const saved = await db.appPreference.findUnique({ where: { id: 'local' } });
  return saved
    ? {
        ...defaultPreferences,
        ...saved,
        defaultView: saved.defaultView === 'original' ? 'original' : 'report',
        theme: (['green', 'blue', 'yellow', 'white'].includes(saved.theme)
          ? saved.theme
          : 'green') as AppPreferences['theme'],
      }
    : defaultPreferences;
}
