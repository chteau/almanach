import { expect, type Page, test } from '@playwright/test';
import { expectAccessible } from './fixtures.ts';

test.describe.configure({ mode: 'serial' });

const PANELS = [
  'profile',
  'companies',
  'rules',
  'numbering',
  'pdf',
  'defaults',
  'stripe',
  'linked',
  'sources',
  'assistants',
  'reminders',
  'calendar',
  'email',
  'password',
  'two-factor',
  'devices',
  'data',
  'instance',
  'packs',
];

/**
 * Signs in as the administrator created by the install test
 *
 * @param page {Page} - page
 * @returns {Promise<void>} - resolves on the dashboard
 */
async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail address').fill('lea@example.com');
  await page.getByLabel('Password').fill('une matinée calme au port');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
}

test('settings are split into panels, reachable from a side menu or a phone list', async ({ page }) => {
  await signIn(page);
  const phone = (page.viewportSize()?.width ?? 1280) < 900;
  const menu = page.getByRole('navigation', { name: 'Settings sections' });

  if (phone) {
    await page.getByRole('link', { name: 'Settings' }).first().click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(menu.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    await expectAccessible(page);
    await menu.getByRole('link', { name: 'Sending e-mails' }).click();
    await expect(page.getByRole('heading', { name: 'Sending e-mails', level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'Settings', exact: true }).last().click();
    await expect(page).toHaveURL(/\/settings$/);
  } else {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings\/profile$/);
    await expect(menu.getByRole('link', { name: 'Profile and situation' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await menu.getByRole('link', { name: 'Devices' }).click();
    await expect(page.getByRole('heading', { name: 'Devices', level: 1 })).toBeVisible();
  }

  await page.goto('/settings#calendar-feed');
  await expect(page).toHaveURL(/\/settings\/calendar$/);
  await page.goto('/settings/not-a-panel');
  await expect(page).toHaveURL(/\/settings(\/profile)?$/);

  for (const panel of PANELS) {
    await page.goto(`/settings/${panel}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expectAccessible(page);
  }
});

test('the profile is edited in place, without the onboarding wizard', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings/profile');
  const profile = page.getByRole('region', { name: 'Business details' });
  await profile.getByLabel('Phone (optional)').fill('+33 1 23 45 67 89');
  await expect(profile.getByText('Unsaved changes')).toBeVisible();
  await profile.getByRole('button', { name: 'Save' }).click();
  await expect(profile.getByText('Profile saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Phone (optional)')).toHaveValue('+33 1 23 45 67 89');
});

test('a mailbox is set up from a provider list, and Outlook explains its registration', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings/email');
  await expect(page.getByText('Not set up')).toBeVisible();

  const account = page.getByRole('region', { name: 'Mailbox used for sending' });
  await account.getByLabel('Provider').selectOption('gmail');
  await expect(account.getByRole('link', { name: 'myaccount.google.com/apppasswords' })).toBeVisible();
  await expect(account.getByLabel('Server')).toHaveValue('smtp.gmail.com');
  await expect(account.getByLabel('Port')).not.toContainText('25 ');
  await account.getByLabel('E-mail address or user name').fill('lea@gmail.example');
  await account.getByLabel('App password').fill('abcd efgh ijkl mnop');
  await account.getByRole('button', { name: 'Save' }).click();
  await expect(account.getByText('Mail settings saved. Send a test to check them.')).toBeVisible();
  await expect(account.getByRole('button', { name: 'Send a test e-mail' })).toBeVisible();
  await expect(page.getByText(/E-mails are sent with Gmail/)).toBeVisible();
  expect(await (await page.request.get('/api/settings/mail')).text()).not.toContain('abcd efgh');
  const port25 = await page.request.put('/api/settings/mail', {
    data: {
      provider: 'other',
      host: 'mail.example.com',
      port: 25,
      security: 'starttls',
      username: 'lea',
      from: 'lea@example.com',
      password: 'secret-password',
    },
  });
  expect(port25.status()).toBe(422);
  expect((await port25.json()).error).toBe('port_not_allowed');

  await account.getByLabel('Provider').selectOption('outlook');
  await expect(account.getByText(/Allow public client flows/)).toBeVisible();
  await expectAccessible(page);

  await page.getByRole('region', { name: 'Danger zone' }).getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Not set up')).toBeVisible();
});
