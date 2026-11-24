import { describe, expect, test } from 'bun:test';
import { render, setupDom } from '../../test/dom.tsx';
import { Notice } from './Notice.tsx';

setupDom();

describe('Notice', () => {
  test('live results are announced: errors as alerts, other tones as status', () => {
    expect(
      render(
        <Notice tone="error" live>
          Failed
        </Notice>,
      ).container.querySelector('[role="alert"]'),
    ).not.toBeNull();
    expect(
      render(
        <Notice tone="success" live>
          Done
        </Notice>,
      ).container.querySelector('[role="status"]'),
    ).not.toBeNull();
  });

  test('static notes are not announced by default', () => {
    const { container } = render(<Notice tone="info">Read only</Notice>);
    expect(container.querySelector('[role]')).toBeNull();
    expect(container.textContent).toBe('Read only');
  });
});
