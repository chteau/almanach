import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { sameOrigin } from './same-origin.ts';

const app = new Hono();
app.use('*', sameOrigin(false));
app.post('/x', (c) => c.body(null, 204));
app.get('/x', (c) => c.body(null, 204));

/**
 * Sends a request to the test app
 *
 * @param method {string} - HTTP method
 * @param headers {Record<string, string>} - request headers
 * @returns {Promise<number>} - response status
 */
async function status(method: string, headers: Record<string, string>): Promise<number> {
  return (await app.request('http://almanach.test/x', { method, headers })).status;
}

describe('sameOrigin', () => {
  test('lets same-origin writes and all reads through', async () => {
    expect(await status('POST', { host: 'almanach.test', origin: 'http://almanach.test' })).toBe(204);
    expect(await status('POST', { host: 'almanach.test' })).toBe(204);
    expect(await status('GET', { host: 'almanach.test', origin: 'https://evil.test' })).toBe(204);
  });

  test('blocks cross-site writes, including JSON and malformed origins', async () => {
    expect(await status('POST', { host: 'almanach.test', origin: 'https://evil.test' })).toBe(403);
    expect(await status('POST', { host: 'almanach.test', origin: 'null' })).toBe(403);
    expect(await status('POST', { host: 'almanach.test', 'sec-fetch-site': 'cross-site' })).toBe(403);
  });
});
