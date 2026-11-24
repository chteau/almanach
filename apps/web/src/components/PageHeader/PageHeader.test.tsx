import { describe, expect, test } from 'bun:test';
import { render, setupDom } from '../../test/dom.tsx';
import { PageHeader } from './PageHeader.tsx';

setupDom();

describe('PageHeader', () => {
  test('renders the focused h1 and sets the document title', () => {
    const { container } = render(<PageHeader title="Settings" width="narrow" />);
    const heading = container.querySelector('h1');
    expect(heading?.textContent).toBe('Settings');
    expect(document.activeElement).toBe(heading);
    expect(document.title).toBe('Settings · Almanach');
  });
});
