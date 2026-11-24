import type { componentsEn } from './components.en.ts';

/** Messages des composants d'interface partagés, en français. */
export const componentsFr: Record<keyof typeof componentsEn, string> = {
  'ui.busy': 'Enregistrement…',
  'ui.saved': 'Enregistré',
  'ui.dirty': 'Modifications non enregistrées',
  'ui.dangerZone': 'Zone sensible',
};
