import type { PackMeta, Profile } from '@almanach/shared';
import { useResource } from '../../lib/useResource.ts';

/**
 * Loads the signed-in person's fiscal profile
 *
 * @returns {Profile | undefined} - the profile, undefined while loading or on error
 */
export function useProfile(): Profile | undefined {
  return useResource<{ profile: Profile; pack: PackMeta | null }>('/api/profile').data?.profile;
}
