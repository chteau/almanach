import type { componentsEn } from './components.en.ts';

/** Meldungen der gemeinsamen Oberflächenkomponenten, auf Deutsch. */
export const componentsDe: Record<keyof typeof componentsEn, string> = {
  'ui.busy': 'Wird gespeichert…',
  'ui.saved': 'Gespeichert',
  'ui.dirty': 'Nicht gespeicherte Änderungen',
  'ui.dangerZone': 'Gefahrenbereich',
};
