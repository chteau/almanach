import { describe, expect, test } from 'bun:test';
import { render, setupDom } from '../../test/dom.tsx';
import { Row } from './Row.tsx';

setupDom();

describe('Row', () => {
  test('renders content then actions, and omits empty slots', () => {
    const { container } = render(
      <Row primary="Acme" meta="Paris" actions={<button type="button">Edit</button>} />,
    );
    expect(container.textContent).toBe('AcmeParisEdit');
    const solo = render(<Row primary="Solo" />).container.firstElementChild;
    expect(solo?.children).toHaveLength(1);
    expect(solo?.firstElementChild?.children).toHaveLength(1);
  });
});
