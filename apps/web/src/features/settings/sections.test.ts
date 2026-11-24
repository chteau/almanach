import { describe, expect, test } from 'bun:test';
import { groupOf, legacyPanel, SETTINGS_GROUPS, visibleGroups } from './sections.ts';

describe('settings sections', () => {
  test('every panel belongs to exactly one group', () => {
    const panels = SETTINGS_GROUPS.flatMap((group) => [...group.panels]);
    expect(new Set(panels).size).toBe(panels.length);
  });

  test('the administration group is shown to administrators only', () => {
    expect(visibleGroups(false).map((group) => group.id)).not.toContain('admin');
    expect(visibleGroups(true).map((group) => group.id)).toContain('admin');
    expect(groupOf('packs', false)).toBeUndefined();
    expect(groupOf('packs', true)?.id).toBe('admin');
    expect(groupOf('email', false)?.id).toBe('notifications');
    expect(groupOf('nope', true)).toBeUndefined();
  });

  test('anchors of the former single page lead to their panel', () => {
    expect(legacyPanel('#calendar-feed')).toBe('calendar');
    expect(legacyPanel('#reminders')).toBe('reminders');
    expect(legacyPanel('billing')).toBe('numbering');
    expect(legacyPanel('#situation')).toBe('profile');
    expect(legacyPanel('#unknown')).toBeUndefined();
  });
});
