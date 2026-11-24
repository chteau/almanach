import { describe, expect, test } from 'bun:test';
import { render, setupDom } from '../../test/dom.tsx';
import { Notice } from './Notice.tsx';

setupDom();

describe('Notice', () => {
  test('announces by default: errors as alerts, other tones as status', () => {
    expect(
      render(<Notice tone="error">Failed</Notice>).container.querySelector('[role="alert"]'),
    ).not.toBeNull();
    expect(
      render(<Notice tone="success">Done</Notice>).container.querySelector('[role="status"]'),
    ).not.toBeNull();
  });

  test('static notes passing live={false} have no role', () => {
    const { container } = render(
      <Notice tone="info" live={false}>
        Read only
      </Notice>,
    );
    expect(container.querySelector('[role]')).toBeNull();
    expect(container.textContent).toBe('Read only');
  });
});
