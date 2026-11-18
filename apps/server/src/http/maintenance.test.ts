import { describe, expect, test } from 'bun:test';
import { maintenanceFetch } from './maintenance.ts';

describe('maintenance mode (S-272)', () => {
  test('API calls get a JSON 503 with Retry-After', async () => {
    const response = maintenanceFetch(new Request('http://localhost/api/clients'));
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('30');
    expect(await response.json()).toEqual({ error: 'maintenance' });
  });

  test('browsers get a self-refreshing page', async () => {
    const response = maintenanceFetch(new Request('http://localhost/calendar'));
    expect(response.status).toBe(503);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(await response.text()).toContain('http-equiv="refresh"');
  });
});
