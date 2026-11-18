import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { BUNDLE_FORMAT, signBundle } from '../apps/server/src/features/packs/signing.ts';
import { hotp } from '../apps/server/src/security/totp.ts';
import { expectAccessible, INSTALL_TOKEN, openSection, PACK_TEST_KEYS } from './fixtures.ts';

test.describe.configure({ mode: 'serial' });

test('a fresh instance is installed through the wizard (S-001 to S-009)', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/install$/);

  await page.getByLabel('Français').check();
  await expect(page.getByRole('heading', { name: 'Bienvenue dans Almanach' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Continuer' }).click();

  const tokenField = page.getByLabel(/Jeton d.installation/);
  await tokenField.fill('wrong-token');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByText(/Ce jeton ne correspond pas/)).toBeVisible();
  await tokenField.fill(INSTALL_TOKEN);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Continuer' }).click();

  await expect(page.getByText('Connectée.')).toBeVisible();
  await expect(page.getByText('À jour.')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Continuer' }).click();

  await page.getByLabel('Adresse e-mail').fill('Lea@Example.com');
  await page.getByLabel('Mot de passe', { exact: true }).fill('court');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByText('Au moins 12 caractères.', { exact: true })).toBeVisible();
  await page.getByLabel('Mot de passe', { exact: true }).fill('une matinée calme au port');
  await expect(page.getByText('Robustesse : bonne')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Continuer' }).click();

  await expect(page.getByLabel('Nom de l’instance')).toHaveValue('Almanach');
  await page.getByLabel('Adresse publique').fill('pas une adresse');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByText(/Saisissez une adresse complète/)).toBeVisible();
  await page.getByLabel('Adresse publique').fill('https://almanach.example.com/');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Continuer' }).click();

  await expect(page.getByText('lea@example.com')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Installer Almanach' }).click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole('heading', { name: 'Où déclarez-vous vos revenus ?' })).toBeVisible();
  const session = (await page.context().cookies()).find((cookie) => cookie.name === 'almanach_session');
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');
});

test('an installed instance refuses the installer for good', async ({ page, request }) => {
  await page.goto('/install');
  await expect(page).toHaveURL(/\/login$/);

  const response = await request.post('/api/install/complete', {
    headers: { 'x-install-token': INSTALL_TOKEN },
    data: {
      locale: 'en',
      admin: { email: 'intruder@example.com', password: 'another long password' },
      instance: { name: 'Pwned', publicUrl: 'https://evil.example.com', timezone: 'UTC' },
    },
  });
  expect(response.status()).toBe(410);
});

test('responses carry strict security headers', async ({ request }) => {
  const page = await request.get('/');
  const csp = page.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain('unsafe-inline');
  expect(page.headers()['x-content-type-options']).toBe('nosniff');

  const api = await request.get('/api/install/status');
  expect(api.headers()['cache-control']).toBe('no-store');
  expect((await request.get('/api/unknown')).status()).toBe(404);
});

test('sign-in refuses wrong passwords without telling whether the account exists (S-010, S-011)', async ({
  page,
}) => {
  await page.goto('/clients');
  await expect(page).toHaveURL(/\/login\?next=%2Fclients$/);
  await page.getByLabel('E-mail address').fill('nobody@example.com');
  await page.getByLabel('Password').fill('whatever-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('E-mail address or password incorrect.')).toBeVisible();
  await page.getByLabel('E-mail address').fill('lea@example.com');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('E-mail address or password incorrect.')).toBeVisible();
  await page.getByText('Forgot your password?').click();
  await expect(page.getByText(/reset-password\.ts/)).toBeVisible();
  await expectAccessible(page);
});

test('first sign-in leads through onboarding, then clients and missions (P02, P03, P07 to P10)', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('E-mail address').fill('lea@example.com');
  await page.getByLabel('Password').fill('une matinée calme au port');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.getByRole('radio', { name: /Germany/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Confirm that you understand the pack is experimental.')).toBeVisible();
  await page.getByRole('radio', { name: /France/ }).check();
  await expect(page.getByText('I understand and will check the figures myself.')).toHaveCount(0);
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('radio', { name: /liberal profession/ }).check();
  await page.getByLabel(/ACRE/).check();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Business name').fill('Léa Martin EI');
  await page.getByLabel('Address').fill('12 rue des Lilas\n35000 Rennes');
  await page.getByLabel('SIRET').fill('732 829 320 00075');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('This number does not have the expected format.')).toBeVisible();
  await page.getByLabel('SIRET').fill('732 829 320 00074');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('IBAN').fill('FR76 3000 6000 0112 3456 7890 188');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('This IBAN is not valid. Check for a typo.')).toBeVisible();
  await page.getByLabel('IBAN').fill('FR76 3000 6000 0112 3456 7890 189');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Revenue already collected' })).toBeVisible();
  await page.getByLabel(/Amount collected/).fill('4 200,50');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Léa Martin EI')).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Start using Almanach' }).click();

  await expect(page.getByRole('heading', { name: 'Welcome to Almanach' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Upcoming deadlines' })).toBeVisible();
  await expectAccessible(page);
  await openSection(page, 'Clients');
  await expect(page.getByRole('heading', { name: 'No clients yet' })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole('link', { name: 'New client' }).click();

  await page.getByLabel('Name', { exact: true }).fill('Nordwind GmbH');
  await page.getByLabel('Country').selectOption('DE');
  await expect(page.getByText(/reverse charge cannot apply/)).toBeVisible();
  await page.getByLabel('VAT number').fill('DE12345');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('This VAT number does not match the format of its country.')).toBeVisible();
  await page.getByLabel('VAT number').fill('DE123456789');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('heading', { name: 'Nordwind GmbH' })).toBeVisible();
  await expect(page.getByText(/reverse charge applies/)).toBeVisible();
  await expectAccessible(page);

  await page.goto('/clients/new');
  await page.getByLabel('Name', { exact: true }).fill('nordwind gmbh');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/already exists: Nordwind GmbH/)).toBeVisible();
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('unsaved changes');
    void dialog.accept();
  });
  await openSection(page, 'Clients');
  await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
  await page.getByRole('link', { name: /Nordwind GmbH/ }).click();

  await page.getByRole('link', { name: 'New mission' }).click();
  await page.getByLabel('Mission name').fill('Refonte du portail');
  await page.getByRole('textbox', { name: 'Daily rate' }).fill('550');
  await page.getByLabel(/End date/).fill('2020-01-01');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('The end date is before the start date.')).toBeVisible();
  await page.getByLabel(/End date/).fill('');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('heading', { name: 'Refonte du portail' })).toBeVisible();
  await expect(page.getByText('€550.00')).toBeVisible();
  await openSection(page, 'Missions');
  await expect(page.getByRole('link', { name: /Refonte du portail/ })).toBeVisible();
  await page.getByLabel('View').selectOption('board');
  await expect(page.getByRole('heading', { name: 'In progress · 1' })).toBeVisible();
  await expectAccessible(page);
});

test('an invoice is drafted from a mission, issued, paid and credited (P12 to P17)', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail address').fill('lea@example.com');
  await page.getByLabel('Password').fill('une matinée calme au port');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

  await openSection(page, 'Invoices');
  await expect(page.getByRole('heading', { name: 'No invoices yet' })).toBeVisible();

  await openSection(page, 'Missions');
  await page.getByRole('link', { name: /Refonte du portail/ }).click();
  await page.getByRole('link', { name: 'New invoice' }).click();
  await expect(page.getByRole('heading', { name: 'Draft invoice' })).toBeVisible();
  await expect(page.getByLabel('Description')).toHaveValue('Refonte du portail');

  await page.getByLabel('Quantity').fill('abc');
  await expect(page.getByText('Enter a quantity such as 1, 1.5 or 7.25.')).toBeVisible();
  await page.getByLabel('Quantity').fill('4,5');
  await page.getByRole('button', { name: 'Add a line' }).click();
  await page.getByLabel('Description').nth(1).fill('Hébergement');
  await page.getByLabel('Unit', { exact: true }).nth(1).selectOption('flat');
  await page.getByLabel('Unit price').nth(1).fill('200');
  await expect(page.locator('dl').getByText('€2,675.00').first()).toBeVisible();
  await expect(page.getByText(/^Saved at/)).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}$/);
  await expect(page.getByText(/article 293 B/)).toBeVisible();
  await expect(page.getByText('the client’s address')).toBeVisible();
  await expectAccessible(page);

  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Issue invoice' }).click();
  await expect(dialog.getByText(/can no longer be changed/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Issue invoice' }).click();
  await expect(page.getByText('The document could not be issued:')).toBeVisible();

  const draftUrl = page.url();
  await openSection(page, 'Clients');
  await page.getByRole('link', { name: /Nordwind GmbH/ }).click();
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel(/^Address/).fill('Hafenstraße 12\n20457 Hamburg');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Nordwind GmbH' })).toBeVisible();
  await page.goto(draftUrl);
  await expect(page.getByText('the client’s address')).toBeHidden();

  await page.getByRole('button', { name: 'Issue invoice' }).click();
  await dialog.getByRole('button', { name: 'Issue invoice' }).click();
  await expect(page.getByRole('heading', { name: /^Invoice F-\d{4}-0001$/ })).toBeVisible();
  await expect(page.getByText('Issued documents cannot be changed.', { exact: false })).toBeVisible();
  await expectAccessible(page);

  const pdf = await page.request.get(`${page.url().replace('/documents/', '/api/documents/')}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

  await page.getByLabel(/^Amount/).fill('1000');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Partially paid')).toBeVisible();
  await page.getByLabel(/^Amount/).fill('2000');
  await expect(page.getByText(/more than what is due/)).toBeVisible();
  await page.getByLabel(/^Amount/).fill('1675');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Paid', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Create a credit note' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create a credit note' }).click();
  await expect(page.getByRole('heading', { name: 'Draft credit note' })).toBeVisible();

  await openSection(page, 'Invoices');
  await expect(page.getByRole('link', { name: /F-\d{4}-0001/ })).toBeVisible();
  await expect(page.getByText(/Collected \(EUR\)/)).toBeVisible();
  await expectAccessible(page);
  await openSection(page, 'Payments');
  await expect(page.getByRole('link', { name: /F-\d{4}-0001/ })).toHaveCount(2);
});

test('dashboard, calendar, deadline, thresholds, reminders and calendar feed (P04 to P06, P18 to P20)', async ({
  page,
  request,
}) => {
  await page.goto('/login');
  await page.getByLabel('E-mail address').fill('lea@example.com');
  await page.getByLabel('Password').fill('une matinée calme au port');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'To set aside this year' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: /Micro regime ceiling/ })).toBeVisible();
  await expectAccessible(page);

  await page.goto('/calendar');
  await page.getByLabel('View').selectOption('list');
  await expect(page.getByRole('link', { name: /Urssaf revenue declaration/ }).first()).toBeVisible();
  await expectAccessible(page);
  await page
    .getByRole('link', { name: /Urssaf revenue declaration/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'What to do' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Source of this deadline' })).toHaveAttribute(
    'href',
    /service-public/,
  );
  await expectAccessible(page);
  await page.getByLabel(/Amount actually paid/).fill('120');
  await page.getByRole('button', { name: 'Mark as done' }).click();
  await expect(page.getByRole('heading', { name: 'Done', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark as not done' }).click();
  await expect(page.getByRole('heading', { name: 'Mark as done' })).toBeVisible();

  await page.goto('/calendar/custom/new');
  await page.getByLabel('Title').fill('Renew insurance');
  await page.getByLabel('Repeat').selectOption('yearly');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/calendar$/);

  await page.goto('/thresholds');
  await expect(page.getByRole('heading', { name: 'Thresholds', exact: true }).first()).toBeVisible();
  await page.getByLabel(/Extra revenue this year/).fill('40000');
  await expect(page.getByText(/Simulation with/)).toBeVisible();
  await expect(page.getByText(/VAT is due from the day the threshold is crossed/)).toBeVisible();
  await expectAccessible(page);

  await page.goto('/settings');
  await expect(page.getByText('Verified', { exact: true }).first()).toBeVisible();
  await page.getByLabel('Remind me this many days before').fill('14, 3, 0');
  await page.getByRole('button', { name: 'Save' }).last().click();
  await expect(page.getByText('Reminder settings saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Create a link' }).click();
  const feed = await page.getByLabel('Subscription link').inputValue();
  expect(feed).toMatch(/\/api\/ical\/[\w-]+\.ics$/);
  const ics = await request.get(new URL(feed).pathname);
  expect(ics.status()).toBe(200);
  expect(ics.headers()['content-type']).toContain('text/calendar');
  const body = await ics.text();
  expect(body).toContain('BEGIN:VCALENDAR');
  expect(body).toContain('Renew insurance');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Revoke the link' }).click();
  await expect(page.getByRole('button', { name: 'Create a link' })).toBeVisible();
  expect((await request.get(new URL(feed).pathname)).status()).toBe(404);
});

test('time is logged by hand and by timer, then invoiced and locked (P11)', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail address').fill('lea@example.com');
  await page.getByLabel('Password').fill('une matinée calme au port');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

  await openSection(page, 'Time');
  await expect(page.getByText('No time logged this week.')).toBeVisible();
  const entry = page.locator('form[aria-labelledby="entry-title"]');
  await entry.getByLabel('Mission').selectOption({ label: 'Refonte du portail · Nordwind GmbH' });
  await entry.getByLabel('Days').fill('abc');
  await entry.getByRole('button', { name: 'Log' }).click();
  await expect(page.getByText(/Enter a duration such as/)).toBeVisible();
  await entry.getByLabel('Days').fill('1,5');
  await entry.getByRole('button', { name: 'Log' }).click();
  await expect(page.getByRole('table', { name: 'Time per mission and day' })).toContainText('1.5 d');
  await expectAccessible(page);

  await page
    .getByRole('region', { name: 'Timer' })
    .getByLabel('Mission')
    .selectOption({ label: 'Refonte du portail · Nordwind GmbH' });
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('timer')).toBeVisible();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();

  await page.getByRole('button', { name: 'Create the invoice' }).click();
  await expect(page.getByRole('heading', { name: 'Draft invoice' })).toBeVisible();
  await expect(page.getByText(/Refonte du portail \(/).first()).toBeVisible();
  await openSection(page, 'Time');
  await expect(page.getByText('All billable time has been invoiced.')).toBeVisible();
  await expect(page.getByText('Invoiced', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Entries this week' }).getByRole('button', { name: 'Delete' }),
  ).toHaveCount(0);
});

test('invoicing settings: numbering, PDF look and defaults (S-234 to S-236)', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail address').fill('lea@example.com');
  await page.getByLabel('Password').fill('une matinée calme au port');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

  await page.goto('/settings');
  const billing = page.locator('#billing');
  const next = new Date().getFullYear() + 1;
  await expect(billing.getByText(/Invoices were already issued/)).toBeVisible();
  await billing.getByLabel('Invoice prefix').fill('FAC');
  await billing.getByLabel('Separator').selectOption('/');
  await expect(
    billing.getByText(`Next numbers: FAC/${next}/0001 · A/${next}/0001 · D/${next}/0001`),
  ).toBeVisible();
  await billing.getByLabel('Invoice prefix').fill('F-1');
  await expect(billing.getByText('Letters and digits only, 1 to 10.')).toBeVisible();
  await billing.getByLabel('Invoice prefix').fill('FAC');
  await billing.getByLabel('Layout').selectOption('band');
  await billing.getByLabel('Payment terms for new clients (days)').fill('45');
  await billing
    .getByLabel(/Default note on new documents/)
    .fill('Pénalités de retard : 3 fois le taux légal.');
  await expectAccessible(page);
  await billing.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(`Saved. The new numbering applies from 1 January ${next}.`)).toBeVisible();
  await expect(billing.getByText(new RegExp(`New format planned from ${next}`))).toBeVisible();

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
  await billing
    .getByLabel('Add a logo')
    .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('Logo saved.')).toBeVisible();
  await expect(billing.getByRole('img', { name: 'Current logo' })).toBeVisible();
  const fake = await page.request.put('/api/billing/logo', {
    data: { mime: 'image/png', data: Buffer.from('<svg/>').toString('base64') },
  });
  expect(fake.status()).toBe(422);
  const preview = await page.request.get('/api/billing/preview.pdf');
  expect(preview.status()).toBe(200);
  expect(preview.headers()['content-type']).toBe('application/pdf');

  await page.goto('/clients/new');
  await expect(page.getByLabel('Payment terms (days)')).toHaveValue('45');
  await page.goto('/documents/new?type=invoice');
  await expect(page.getByLabel(/Note at the bottom of the document/)).toHaveValue(/Pénalités de retard/);
});

test('clients are imported from a CSV with a report of rejected lines (S-091, S-092, S-247)', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('E-mail address').fill('lea@example.com');
  await page.getByLabel('Password').fill('une matinée calme au port');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

  await openSection(page, 'Clients');
  await page.getByRole('link', { name: 'Import a CSV' }).click();
  await expect(page.getByRole('heading', { name: 'Import clients' })).toBeVisible();
  const csv = [
    'Raison sociale;Pays;Courriel;Délai de paiement;Colonne libre',
    'Studio Kappa;FR;compta@kappa.example;15;x',
    'Nordwind GmbH;DE;;;y',
    '"Atelier ""Lumen""";FR;pas-un-email;;z',
  ].join('\r\n');
  await page.getByLabel('Choose a CSV file').setInputFiles({
    name: 'clients.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(page.getByText('3 line(s) found.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Raison sociale')).toHaveValue('name');
  await expect(page.getByLabel('Délai de paiement')).toHaveValue('payment_terms_days');
  await expect(page.getByLabel('Colonne libre')).toHaveValue('');
  await expectAccessible(page);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText('1 client(s) ready to import.')).toBeVisible();
  await expect(page.getByText(/Line 3 \(Nordwind GmbH\).*already exists/)).toBeVisible();
  await expect(page.getByText(/Line 4 \(Atelier "Lumen"\).*E-mail is not valid/)).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 client(s)' }).click();
  await expect(page.getByText('1 client(s) imported.')).toBeVisible();
  await page.getByRole('link', { name: 'See the clients' }).click();
  await expect(page.getByRole('link', { name: /Studio Kappa/ })).toBeVisible();
});

test('signed pack updates, data export, search and system pages (P20 to P22)', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('E-mail address').fill('lea@example.com');
  await page.getByLabel('Password').fill('une matinée calme au port');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

  const files: Record<string, string> = {};
  for (const name of readdirSync('packs/fr')) files[name] = readFileSync(`packs/fr/${name}`, 'utf8');
  const bundle = (sequence: number) =>
    signBundle(
      {
        format: BUNDLE_FORMAT,
        country: 'FR',
        sequence,
        createdAt: new Date().toISOString(),
        notes: `Test ${sequence}`,
        files,
      },
      PACK_TEST_KEYS.privateKey,
    );
  const upload = (name: string, content: unknown) =>
    page.getByLabel('Import a signed update').setInputFiles({
      name,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(content)),
    });

  await page.goto('/settings');
  const packs = page.getByRole('region', { name: 'Country rule packs' });
  await expect(packs.getByText(/Shipped with Almanach/).first()).toBeVisible();
  const first = bundle(1);
  await upload('fr-1.json', { ...first, payload: `${first.payload.slice(0, -4)}AAAA` });
  await expect(page.getByText(/The signature is not valid/)).toBeVisible();
  await upload('fr-1.json', first);
  await expect(
    page.getByText('Update FR #1 received. Read what it changes below, then apply it.'),
  ).toBeVisible();
  const pending = packs.getByRole('region', { name: 'Update available: FR #1' });
  await expect(pending.getByText('No change to the rules in use.')).toBeVisible();
  await expectAccessible(page);
  await pending.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Update FR #1 applied.')).toBeVisible();
  await upload('fr-1.json', first);
  await expect(page.getByText('A same or newer version is already installed.')).toBeVisible();
  files['2026.yaml'] = (files['2026.yaml'] ?? '').replace(
    'rates: [{ from: "2026-01-01", rateBp: 2560 }]',
    'rates: [{ from: "2026-01-01", rateBp: 2560 }, { from: "2026-07-01", rateBp: 2600 }]',
  );
  await upload('fr-2.json', bundle(2));
  const second = packs.getByRole('region', { name: 'Update available: FR #2' });
  await expect(
    second.getByText(/the rate goes from 25\.6 % to 26 % on Jul 1, 2026\. Your 2026 estimates change\./),
  ).toBeVisible();
  await second.getByRole('button', { name: 'Later' }).click();
  await expect(second).toHaveCount(0);
  await page.reload();
  await packs
    .getByRole('region', { name: 'Update available: FR #2' })
    .getByRole('button', { name: 'Apply' })
    .click();
  await expect(page.getByText('Update FR #2 applied.')).toBeVisible();
  await expect(packs.getByText(/Automatic checking needs PACK_UPDATE_URL/)).toBeVisible();
  await packs.getByRole('button', { name: 'Use this version' }).click();
  await expect(page.getByText('FR now uses update #1.')).toBeVisible();
  await packs.getByRole('button', { name: 'Back to the shipped pack' }).click();
  await expect(page.getByText('FR uses the shipped pack again.')).toBeVisible();
  await expectAccessible(page);

  const exported = await page.request.get('/api/account/export');
  expect(exported.status()).toBe(200);
  expect(exported.headers()['content-disposition']).toContain('attachment');
  const data = (await exported.json()) as {
    format: string;
    data: { clients: unknown[]; documents: unknown[] };
  };
  expect(data.format).toBe('almanach-export/1');
  expect(data.data.clients.length).toBeGreaterThan(0);
  expect(JSON.stringify(data)).not.toContain('icalTokenHash":"');
  const reimport = await page.request.post('/api/account/import', { data });
  expect(reimport.status()).toBe(409);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await page.keyboard.press('Control+k');
  const search = page.getByRole('dialog', { name: 'Search' });
  await expect(search).toBeVisible();
  await search.getByRole('searchbox').fill('nordw');
  await expect(search.getByRole('link', { name: 'Nordwind GmbH', exact: true })).toBeVisible();
  await expect(search.getByRole('link', { name: 'New invoice' })).toBeVisible();
  await expect(search.getByRole('link', { name: /F-\d{4}-0001/ }).first()).toBeVisible();
  await expectAccessible(page);
  await search.getByRole('link', { name: 'Nordwind GmbH', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nordwind GmbH' })).toBeVisible();

  await page.goto('/this-page-does-not-exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expectAccessible(page);
});

test('two-step sign-in protects the account and sessions can be revoked (S-260 to S-263)', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('E-mail address').fill('lea@example.com');
  await page.getByLabel('Password').fill('une matinée calme au port');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Turn on' }).click();
  const secret = (await page.getByLabel('Setup key').inputValue()).replace(/\s/g, '');
  await page.getByLabel('Authenticator code').fill('000000');
  await page.getByRole('button', { name: 'Confirm and turn on' }).click();
  await expect(page.getByText(/This code is not valid/)).toBeVisible();
  await page.getByLabel('Authenticator code').fill(hotp(secret, Math.floor(Date.now() / 30_000)));
  await page.getByRole('button', { name: 'Confirm and turn on' }).click();
  await expect(page.getByText(/Keep these recovery codes/)).toBeVisible();
  const recovery = ((await page.locator('code').last().textContent()) ?? '').split('\n')[0] ?? '';
  expect(recovery).toMatch(/^[a-z0-9]{10}$/);

  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('E-mail address').fill('lea@example.com');
  await page.getByLabel('Password').fill('une matinée calme au port');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByLabel('Authenticator code')).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel('Authenticator code').fill(recovery);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

  await page.goto('/settings');
  await expect(page.getByText('7 recovery code(s) left.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Sign out every other device' }).click();
  await expect(page.getByRole('button', { name: 'Sign out every other device' })).toHaveCount(0);
  await page.locator('#totp-title').scrollIntoViewIfNeeded();
  await page
    .getByRole('region', { name: 'Two-step sign-in' })
    .getByLabel('Current password')
    .fill('une matinée calme au port');
  await page.getByRole('button', { name: 'Turn off two-step sign-in' }).click();
  await expect(page.getByRole('button', { name: 'Turn on' })).toBeVisible();
  await expectAccessible(page);
});

test('the API refuses another account’s data and unauthenticated calls', async ({ request }) => {
  expect((await request.get('/api/clients')).status()).toBe(401);
  expect((await request.get('/api/missions/not-a-uuid')).status()).toBe(401);
  expect((await request.get('/api/documents')).status()).toBe(401);
  expect((await request.get('/api/payments')).status()).toBe(401);
  expect((await request.get('/api/dashboard')).status()).toBe(401);
  expect((await request.get('/api/account')).status()).toBe(401);
  expect((await request.get('/api/ical/forged-token.ics')).status()).toBe(404);
  const forged = await request.post('/api/auth/login', {
    headers: { origin: 'https://evil.example.com' },
    data: { email: 'lea@example.com', password: 'une matinée calme au port' },
  });
  expect(forged.status()).toBe(403);
});

test('a change of situation splits the obligations, and a cessation makes the account read-only (S-231 to S-233)', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('E-mail address').fill('lea@example.com');
  await page.getByLabel('Password').fill('une matinée calme au port');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

  // The account was created today: move the start of activity back so a past change is possible.
  const { profile } = (await (await page.request.get('/api/profile')).json()) as {
    profile: Record<string, unknown>;
  };
  const { ceasedOn: _ceased, ...editable } = profile;
  expect(
    (await page.request.put('/api/profile', { data: { ...editable, activityStart: '2025-01-06' } })).status(),
  ).toBe(204);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  await page.goto('/settings');
  const situation = page.locator('#situation');
  await situation.getByRole('button', { name: 'Change status or country' }).click();
  await situation.getByLabel('Effective from').fill(yesterday);
  await situation.getByLabel('Status').selectOption('micro_bic_services');
  await situation.getByLabel('Declarations').selectOption('quarterly');
  await expectAccessible(page);
  await situation.getByRole('button', { name: 'Save the change' }).click();
  await expect(situation.getByText(/New situation recorded from/)).toBeVisible();
  await expect(situation.getByText(/From .*: France · .* → France · .*Quarterly/)).toBeVisible();

  // With a history, the profile form can no longer move the status without a date.
  const locked = await page.request.put('/api/profile', {
    data: { ...editable, activityStart: '2025-01-06' },
  });
  expect(locked.status()).toBe(409);
  expect((await locked.json()).error).toBe('use_situation');

  await situation.getByRole('button', { name: 'Declare the end of activity' }).click();
  await situation.getByLabel('Last day of activity').fill(yesterday);
  await situation.getByRole('button', { name: 'Confirm the end of activity' }).click();
  await expect(situation.getByText(/Activity ended on/)).toBeVisible();
  const blocked = await page.request.post('/api/clients', {
    data: {
      kind: 'company',
      name: 'Too late',
      email: null,
      phone: null,
      address: null,
      country: 'FR',
      vatNumber: null,
      currency: 'EUR',
      language: 'fr',
      paymentTermsDays: 30,
      contacts: [],
      notes: null,
    },
  });
  expect(blocked.status()).toBe(409);
  expect((await page.request.get('/api/clients')).status()).toBe(200);

  await situation.getByRole('button', { name: 'Cancel the end of activity' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel the end of activity' }).click();
  await expect(situation.getByText('End of activity cancelled.')).toBeVisible();
  await situation.getByRole('button', { name: 'Undo the latest change' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Undo the latest change' }).click();
  await expect(situation.getByText('Latest change undone.')).toBeVisible();
});
