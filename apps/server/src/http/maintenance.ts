/** Page shown while the database is migrated or the administrator set MAINTENANCE=true (S-272). */
const PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="15">
<title>Almanach — maintenance</title>
<style>
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
main { max-width: 480px; padding: 24px; }
h1 { font-size: 24px; margin: 0 0 12px; }
p { line-height: 1.5; margin: 0 0 12px; }
</style>
</head>
<body>
<main>
<h1>Almanach est en cours de mise à jour</h1>
<p>Vos données sont en sécurité. La page se rechargera d’elle-même dans quelques instants.</p>
<p lang="en">Almanach is being updated. Your data is safe; this page reloads by itself in a moment.</p>
<p lang="de">Almanach wird gerade aktualisiert. Ihre Daten sind sicher; die Seite lädt sich gleich von selbst neu.</p>
</main>
</body>
</html>`;

/**
 * Answers every request while the instance is not ready: 503 with Retry-After, JSON for the API and a
 * self-refreshing page for browsers. Nothing is read from the database.
 *
 * @param request {Request} - incoming request
 * @returns {Response} - maintenance answer
 */
export function maintenanceFetch(request: Request): Response {
  const headers = {
    'Retry-After': '30',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  };
  if (new URL(request.url).pathname.startsWith('/api/')) {
    return Response.json({ error: 'maintenance' }, { status: 503, headers });
  }
  return new Response(PAGE, {
    status: 503,
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
  });
}
