import { describe, expect, test } from 'bun:test';
import { render, setupDom } from '../../test/dom.tsx';
import { EmptyState } from './EmptyState.tsx';

setupDom();

describe('EmptyState', () => {
  test('uses a page-level h2 by default and an h3 inline', () => {
    expect(
      render(<EmptyState title="No clients" body="Add one" />).container.querySelector('h2'),
    ).not.toBeNull();
    const { container } = render(<EmptyState inline title="No contacts" body="None yet" />);
    expect(container.querySelector('h3')?.textContent).toBe('No contacts');
    expect(container.querySelector('h2')).toBeNull();
  });
});
