import type { CompanyActivity, Locale, PackMeta } from '@almanach/shared';
import { type Resource, useResource } from '../../lib/useResource.ts';

/** Activities of the active company and the statuses of its country pack, as returned by the API. */
export interface ActivitiesData {
  activities: CompanyActivity[];
  statuses: PackMeta['statuses'];
}

/**
 * Loads the activities of the active company (main one first) and the statuses that can be added
 *
 * @returns {Resource<ActivitiesData>} - activities resource
 */
export function useActivities(): Resource<ActivitiesData> {
  return useResource<ActivitiesData>('/api/profile/activities');
}

/**
 * Names a status in the interface language
 *
 * @param statuses {PackMeta['statuses']} - statuses of the pack
 * @param status {string} - status id
 * @param locale {Locale} - interface language
 * @returns {string} - label, or the id when the pack does not list it
 */
export function statusLabel(statuses: PackMeta['statuses'], status: string, locale: Locale): string {
  return statuses.find((item) => item.id === status)?.label[locale] ?? status;
}
