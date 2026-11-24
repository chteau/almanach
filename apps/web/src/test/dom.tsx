import { afterAll, afterEach, beforeAll } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nProvider } from '../i18n/I18nProvider.tsx';

const mounted: Root[] = [];

/**
 * Gives the current test file a browser-like DOM and removes it afterwards, so the server tests that
 * share the process keep Bun's own fetch, Request and Response
 */
export function setupDom(): void {
  beforeAll(() => {
    if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.setItem('almanach.locale', 'en');
  });
  afterEach(() => {
    for (const root of mounted.splice(0)) act(() => root.unmount());
    document.body.innerHTML = '';
  });
  afterAll(() => GlobalRegistrator.unregister());
}

/**
 * Renders a tree inside the i18n provider, in English
 *
 * @param ui {ReactNode} - tree to render
 * @returns {{ container: HTMLElement, rerender: (next: ReactNode) => void }} - host element and re-render helper
 */
export function render(ui: ReactNode): { container: HTMLElement; rerender: (next: ReactNode) => void } {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  const rerender = (next: ReactNode) => act(() => root.render(<I18nProvider>{next}</I18nProvider>));
  rerender(ui);
  return { container, rerender };
}

/**
 * Clicks an element inside act so React flushes the resulting updates
 *
 * @param element {Element | null} - element to click
 */
export function click(element: Element | null): void {
  if (!(element instanceof HTMLElement)) throw new Error('Nothing to click');
  act(() => element.click());
}
