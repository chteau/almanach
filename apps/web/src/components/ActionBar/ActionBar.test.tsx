import { describe, expect, test } from 'bun:test';
import { act } from 'react';
import { click, render, setupDom } from '../../test/dom.tsx';
import { ActionBar, type ActionFeedback } from './ActionBar.tsx';

setupDom();

describe('ActionBar', () => {
  test('the primary button submits by default, comes last and shows dirty changes', () => {
    const { container } = render(
      <ActionBar primaryLabel="Save" dirty>
        <button type="button">Reset</button>
      </ActionBar>,
    );
    const buttons = container.querySelectorAll('button');
    expect(buttons[buttons.length - 1]?.type).toBe('submit');
    expect(container.textContent).toContain('Unsaved changes');
  });

  test('busy keeps the bar on the saving label and hides the dirty indicator', () => {
    const { container } = render(<ActionBar primaryLabel="Save" busy dirty />);
    const button = container.querySelector('button');
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(container.textContent).toBe('Saving…');
  });

  test('announces a success next to the button, then hides it', async () => {
    let clicks = 0;
    const feedback: ActionFeedback = { tone: 'success' };
    const { container } = render(
      <ActionBar
        primaryLabel="Save"
        onPrimary={() => clicks++}
        feedback={feedback}
        successDuration={20}
        dirty
      />,
    );
    click(container.querySelector('button'));
    expect(clicks).toBe(1);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Saved');
    expect(container.textContent).not.toContain('Unsaved changes');
    await act(() => new Promise((resolve) => setTimeout(resolve, 40)));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('');
  });

  test('keeps an error visible', async () => {
    const { container } = render(
      <ActionBar
        primaryLabel="Save"
        feedback={{ tone: 'error', text: 'Network down' }}
        successDuration={10}
      />,
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Network down');
  });
});
