/** Settings navigation: groups of panels, each panel reachable at /settings/:panel. */
export const SETTINGS_GROUPS = [
  { id: 'activity', panels: ['profile', 'companies', 'rules'] },
  { id: 'billing', panels: ['numbering', 'pdf', 'defaults'] },
  { id: 'connections', panels: ['stripe', 'linked', 'sources', 'assistants'] },
  { id: 'notifications', panels: ['reminders', 'calendar', 'email'] },
  { id: 'account', panels: ['password', 'two-factor', 'devices'] },
  { id: 'data', panels: ['data'] },
  { id: 'admin', panels: ['instance', 'packs'], admin: true },
] as const;

export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];
export type SettingsGroupId = SettingsGroup['id'];
export type SettingsPanel = SettingsGroup['panels'][number];

/** Anchors of the former single settings page, mapped to their panel so old links keep working. */
const LEGACY_ANCHORS: Record<string, SettingsPanel> = {
  profile: 'profile',
  situation: 'profile',
  companies: 'companies',
  activities: 'companies',
  pack: 'rules',
  billing: 'numbering',
  stripe: 'stripe',
  federation: 'linked',
  external: 'sources',
  tokens: 'assistants',
  reminders: 'reminders',
  'calendar-feed': 'calendar',
  password: 'password',
  totp: 'two-factor',
  sessions: 'devices',
  data: 'data',
  system: 'instance',
  packs: 'packs',
};

/**
 * Lists the groups a person may see: the administration group only for administrators
 *
 * @param admin {boolean} - whether the person is an administrator
 * @returns {readonly SettingsGroup[]} - visible groups, in navigation order
 */
export function visibleGroups(admin: boolean): readonly SettingsGroup[] {
  return SETTINGS_GROUPS.filter((group) => !('admin' in group) || admin);
}

/**
 * Finds the group of a panel among the visible ones
 *
 * @param panel {string | undefined} - panel id from the URL
 * @param admin {boolean} - whether the person is an administrator
 * @returns {SettingsGroup | undefined} - its group, or undefined for an unknown or forbidden panel
 */
export function groupOf(panel: string | undefined, admin: boolean): SettingsGroup | undefined {
  return visibleGroups(admin).find((group) => (group.panels as readonly string[]).includes(panel ?? ''));
}

/**
 * Maps an anchor of the former settings page to its panel
 *
 * @param hash {string} - location hash, with or without the leading #
 * @returns {SettingsPanel | undefined} - the panel, if the anchor is known
 */
export function legacyPanel(hash: string): SettingsPanel | undefined {
  return LEGACY_ANCHORS[hash.replace(/^#/, '')];
}
