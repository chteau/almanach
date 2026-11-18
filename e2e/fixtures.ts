import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** Installation token preset for end-to-end servers. */
export const INSTALL_TOKEN = 'e2e-install-token-0123456789abcdef-0123';

/** Test-only pack signing key pair; the public half is trusted by end-to-end servers. Never use it elsewhere. */
export const PACK_TEST_KEYS = {
  publicKey: 'rsYLbmN9Z0iTCWQS-8Z2OW9UPTPSI5NgMEb3dvQd-uw',
  privateKey: `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIB9lKPLBGS0DT6HKphY7bRzYnpsnoxLv0g1e3wuP1as4
-----END PRIVATE KEY-----`,
};

/**
 * Fails the test when the page has serious or critical WCAG 2 A/AA violations
 *
 * @param page {Page} - page to audit
 * @returns {Promise<void>} - resolves when the audit passes
 */
export async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const blocking = results.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? ''),
  );
  expect(
    blocking.map(
      (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
    ),
  ).toEqual([]);
}

/**
 * Opens a section from the main navigation, going through the phone "Menu" page when the section is
 * not in the bottom tab bar
 *
 * @param page {Page} - page
 * @param name {string} - visible name of the section
 * @returns {Promise<void>} - resolves once the link is clicked
 */
export async function openSection(page: Page, name: string): Promise<void> {
  const link = page.getByRole('navigation').getByRole('link', { name, exact: true });
  if (await link.isVisible()) {
    await link.click();
    return;
  }
  await page.getByRole('navigation').getByRole('link', { name: 'Menu', exact: true }).click();
  await page.getByRole('main').getByRole('link', { name, exact: true }).click();
}
