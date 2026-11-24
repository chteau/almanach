import { describe, expect, test } from 'bun:test';
import { render, setupDom } from '../../test/dom.tsx';
import { applyPreset, MAIL_PRESETS, MAIL_PROVIDERS, ProviderHelp, securityFor } from './MailSettings.tsx';

setupDom();

const blank = {
  provider: 'other' as const,
  host: 'mail.example.com',
  port: 465,
  username: 'me',
  from: '',
  password: '',
};

describe('mail providers', () => {
  test('no provider ever offers port 25, and every named one has a server', () => {
    for (const provider of MAIL_PROVIDERS) {
      expect(MAIL_PRESETS[provider].ports).not.toContain(25);
      if (provider !== 'other') expect(MAIL_PRESETS[provider].host).not.toBe('');
    }
    expect(MAIL_PRESETS.other.ports).toEqual([587, 465]);
  });

  test('choosing a provider fills its server and first port, and keeps the account', () => {
    expect(applyPreset(blank, 'gmail')).toEqual({
      ...blank,
      provider: 'gmail',
      host: 'smtp.gmail.com',
      port: 465,
    });
    expect(applyPreset(blank, 'outlook')).toMatchObject({ host: 'smtp-mail.outlook.com', port: 587 });
    expect(applyPreset(blank, 'proton_bridge')).toMatchObject({ host: '127.0.0.1', port: 1025 });
    expect(applyPreset({ ...blank, provider: 'gmail' }, 'other')).toMatchObject({ host: '', port: 587 });
  });

  test('port 465 uses implicit TLS, the others STARTTLS', () => {
    expect(securityFor(465)).toBe('tls');
    expect(securityFor(587)).toBe('starttls');
    expect(securityFor(1025)).toBe('starttls');
  });

  test('Gmail help links to app passwords, Outlook explains its registration when not set up', () => {
    const gmail = render(<ProviderHelp provider="gmail" outlookAvailable={false} />).container;
    expect(gmail.querySelector('a')?.getAttribute('href')).toBe('https://myaccount.google.com/apppasswords');
    expect(gmail.textContent).toContain('2-Step Verification');
    const outlook = render(<ProviderHelp provider="outlook" outlookAvailable={false} />).container;
    expect(outlook.textContent).toContain('Allow public client flows');
    expect(outlook.textContent).toContain('MS_OAUTH_CLIENT_ID');
    const ready = render(<ProviderHelp provider="outlook" outlookAvailable />).container;
    expect(ready.textContent).not.toContain('MS_OAUTH_CLIENT_ID');
  });
});
