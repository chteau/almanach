import { describe, expect, test } from 'bun:test';
import { click, render, setupDom } from '../../test/dom.tsx';
import { DangerAction, DangerZone } from './DangerZone.tsx';

setupDom();

/**
 * Renders a danger zone with one action and counts confirmed runs
 *
 * @returns {{ container: HTMLElement, runs: () => number }} - host element and confirmed-run counter
 */
function renderZone(): { container: HTMLElement; runs: () => number } {
  let count = 0;
  const { container } = render(
    <DangerZone>
      <DangerAction
        label="Delete the company"
        consequence="Its documents are deleted too."
        actionLabel="Delete"
        onConfirm={() => count++}
      />
    </DangerZone>,
  );
  return { container, runs: () => count };
}

describe('DangerZone', () => {
  test('is a region named "Danger zone" listing label and consequence', () => {
    const { container } = renderZone();
    const heading = container.querySelector('h2');
    expect(heading?.textContent).toBe('Danger zone');
    expect(container.querySelector('section')?.getAttribute('aria-labelledby')).toBe(
      heading?.id ?? 'missing',
    );
    expect(container.querySelector('li')?.textContent).toContain('Its documents are deleted too.');
  });

  test('the danger button only opens the confirmation; the action runs once confirmed', () => {
    const { container, runs } = renderZone();
    const dialog = container.querySelector('dialog');
    click(container.querySelector('li > div button'));
    expect(runs()).toBe(0);
    expect(dialog?.open).toBe(true);
    const [, confirm] = dialog?.querySelectorAll('button') ?? [];
    click(confirm ?? null);
    expect(runs()).toBe(1);
    expect(dialog?.open).toBe(false);
  });

  test('cancelling the confirmation does not run the action', () => {
    const { container, runs } = renderZone();
    click(container.querySelector('li > div button'));
    click(container.querySelector('dialog button'));
    expect(runs()).toBe(0);
    expect(container.querySelector('dialog')?.open).toBe(false);
  });
});
