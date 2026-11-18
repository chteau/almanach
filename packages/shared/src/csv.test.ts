import { describe, expect, test } from 'bun:test';
import { clientFromCsv, guessField, parseCsv } from './csv.ts';

const defaults = { country: 'FR', currency: 'EUR', language: 'fr' as const, paymentTermsDays: 30 };

describe('client CSV import (S-092, S-247)', () => {
  test('parses quoted cells, semicolons and Windows line endings', () => {
    const rows = parseCsv(
      '﻿Nom;Adresse;E-mail\r\n"Atelier ""Lumen""";"8 quai des Arts\n44000 Nantes";a@b.fr\r\n\r\nKappa;;\r\n',
    );
    expect(rows).toEqual([
      ['Nom', 'Adresse', 'E-mail'],
      ['Atelier "Lumen"', '8 quai des Arts\n44000 Nantes', 'a@b.fr'],
      ['Kappa', '', ''],
    ]);
  });

  test('recognises headers in three languages', () => {
    expect(guessField('Raison sociale')).toBe('name');
    expect(guessField('Délai de paiement')).toBe('payment_terms_days');
    expect(guessField('USt-IdNr')).toBe('vat_number');
    expect(guessField('Colonne inconnue')).toBeNull();
  });

  test('fills empty columns with defaults and normalises values', () => {
    const result = clientFromCsv(
      { name: 'Nordwind GmbH', country: 'de', vat_number: 'DE 123 456 789', language: 'Deutsch' },
      defaults,
    );
    expect(result).toEqual({
      client: expect.objectContaining({
        country: 'DE',
        vatNumber: 'DE123456789',
        language: 'de',
        currency: 'EUR',
        paymentTermsDays: 30,
      }),
    });
  });

  test('reports what is wrong with a row', () => {
    const result = clientFromCsv({ name: '', email: 'not-an-email', payment_terms_days: '400' }, defaults);
    expect('issues' in result && result.issues.map((issue) => issue.field).sort()).toEqual([
      'email',
      'name',
      'payment_terms_days',
    ]);
  });

  test('an unknown kind or a non-decimal term is reported, not guessed', () => {
    const result = clientFromCsv(
      { name: 'Kappa', kind: 'association', payment_terms_days: '0x1E' },
      defaults,
    );
    expect('issues' in result && result.issues.map((issue) => issue.field).sort()).toEqual([
      'kind',
      'payment_terms_days',
    ]);
    const company = clientFromCsv({ name: 'Kappa', kind: 'Société' }, defaults);
    expect('client' in company && company.client.kind).toBe('company');
  });
});
