import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { MiddlewareHandler } from 'hono';

/**
 * Serves the built web app and falls back to index.html for client-side routes; paths are resolved
 * inside the build folder only, so traversal attempts get the SPA shell instead of a file
 *
 * @param root {string} - absolute path of the Vite build output
 * @returns {MiddlewareHandler} - middleware answering GET and HEAD requests
 */
export function serveWebApp(root: string): MiddlewareHandler {
  const index = resolve(root, 'index.html');
  return async (c) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return c.text('Bad Request', 400);
    }
    const candidate = resolve(root, `.${pathname}`);
    if (candidate.startsWith(root + sep) && (await isFile(candidate))) {
      const immutable = pathname.startsWith('/assets/');
      return new Response(Bun.file(candidate), {
        headers: { 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' },
      });
    }
    if (!(await isFile(index))) return c.text('Web app not built. Run `bun run build`.', 503);
    return new Response(Bun.file(index), {
      headers: { 'Cache-Control': 'no-cache', 'Content-Type': 'text/html; charset=utf-8' },
    });
  };
}

/**
 * Tells whether a path is an existing regular file
 *
 * @param path {string} - absolute path
 * @returns {Promise<boolean>} - true for regular files, false for directories or missing paths
 */
async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
