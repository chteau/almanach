import { expect, type Page, test } from '@playwright/test';
import { expectAccessible } from './fixtures.ts';

test.describe.configure({ mode: 'serial' });

/**
 * Signs in the person created by install.e2e.ts, on a 390 px wide screen
 *
 * @param page {Page} - browser page
 * @returns {Promise<void>} - resolves on the dashboard
 */
async function signIn(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await page.getByLabel('E-mail address').fill('lea@example.com');
  await page.getByLabel('Password').fill('une matinée calme au port');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}

/**
 * Fails when the page scrolls sideways
 *
 * @param page {Page} - browser page
 * @returns {Promise<void>} - resolves when the page fits
 */
async function expectNoSideScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test('pipeline: a prospect deal is added and moved to another stage from its menu, on a phone', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/pipeline');
  await expect(page.getByRole('heading', { name: 'Pipeline', exact: true })).toBeVisible();
  await page.getByLabel('Title').fill('Site vitrine');
  await page.getByLabel('Prospect', { exact: true }).fill('Boulangerie Martin');
  await page.getByLabel(/^Amount/).fill('3000');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const card = page.getByRole('article', { name: 'Site vitrine' });
  await expect(card).toBeVisible();
  await card.getByLabel('Change stage').selectOption('quote_sent');
  await expect(page.getByRole('heading', { name: /Quote sent \(1\)/ })).toBeVisible();
  await expectNoSideScroll(page);
  await expectAccessible(page);
});

test('vault: a document with an expiry date is listed as expiring, on a phone', async ({ page }) => {
  await signIn(page);
  await page.goto('/vault');
  await expect(page.getByRole('heading', { name: 'Document vault' })).toBeVisible();
  await page.getByLabel('Kind', { exact: true }).selectOption('rc_pro');
  await page.getByLabel(/^Title/).fill('RC Pro 2026');
  const soon = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel(/^Expires on/).fill(soon);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('link', { name: 'RC Pro 2026' })).toBeVisible();
  await expect(page.getByText('Expiring', { exact: true })).toBeVisible();
  await expectNoSideScroll(page);
  await expectAccessible(page);
});
