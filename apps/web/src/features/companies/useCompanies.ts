import type { Company } from '@almanach/shared';
import { api } from '../../lib/api.ts';
import { type Resource, useResource } from '../../lib/useResource.ts';

/**
 * Loads the signed-in person's companies and the active one
 *
 * @returns {Resource<{ companies: Company[]; active: string }>} - companies resource
 */
export function useCompanies(): Resource<{ companies: Company[]; active: string }> {
  return useResource('/api/companies');
}

/**
 * Makes a company the active one and reloads the app on it
 *
 * @param id {string} - company id
 * @returns {Promise<void>} - resolves once the page starts reloading
 */
export async function activateCompany(id: string): Promise<void> {
  await api('/api/companies/active', { method: 'PUT', body: { id } });
  window.location.assign('/');
}
