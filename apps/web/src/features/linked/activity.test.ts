import { describe, expect, test } from 'bun:test';
import { labelsOf, linkedPath, originUrl, showsLink, showsLocal } from './activity.ts';

describe('activity filter', () => {
  test('"all" shows everything, "this instance" only local records, a link only its own', () => {
    expect([showsLocal(''), showsLink('', 'l1')]).toEqual([true, true]);
    expect([showsLocal('here'), showsLink('here', 'l1')]).toEqual([true, false]);
    expect([showsLocal('l1'), showsLink('l1', 'l1'), showsLink('l1', 'l2')]).toEqual([false, true, false]);
  });

  test('badges name the activity of each link', () => {
    const labels = labelsOf({
      sources: [{ id: 'l1', label: 'SEKLYR', url: null, kind: 'link', test: false }],
      clients: [],
      documents: [],
      payments: [],
    });
    expect(labels.get('l1')).toBe('SEKLYR');
    expect(labelsOf(undefined).size).toBe(0);
  });

  test('records open read-only here, and on their instance of origin when its address is known', () => {
    expect(linkedPath('document', 'l1', 'd1')).toBe('/linked/document/l1/d1');
    expect(originUrl('https://seklyr.vpn/', 'document', { id: 'd1' })).toBe(
      'https://seklyr.vpn/documents/d1',
    );
    expect(originUrl('https://seklyr.vpn', 'payment', { id: 'p1', documentId: 'd1' })).toBe(
      'https://seklyr.vpn/documents/d1',
    );
    expect(originUrl('https://seklyr.vpn', 'payment', { id: 'p1', documentId: null })).toBe(
      'https://seklyr.vpn/payments',
    );
    expect(originUrl(null, 'client', { id: 'c1' })).toBeNull();
    expect(originUrl('javascript:alert(1)', 'client', { id: 'c1' })).toBeNull();
  });
});
