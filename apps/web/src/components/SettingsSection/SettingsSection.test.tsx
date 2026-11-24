import { describe, expect, test } from 'bun:test';
import { render, setupDom } from '../../test/dom.tsx';
import { SettingsSection } from './SettingsSection.tsx';

setupDom();

describe('SettingsSection', () => {
  test('is a region named by its h2, with description, badge, body and footer', () => {
    const { container } = render(
      <SettingsSection
        title="Profile"
        description="Who you are"
        badge={<span>Active</span>}
        footer={<footer>Bar</footer>}
      >
        <p>Body</p>
      </SettingsSection>,
    );
    const section = container.querySelector('section');
    const heading = container.querySelector('h2');
    expect(section?.getAttribute('aria-labelledby')).toBe(heading?.id ?? 'missing');
    expect(section?.textContent).toBe('ProfileWho you areActiveBodyBar');
  });
});
