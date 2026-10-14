# Error diagnostics

The website records uncaught browser errors, unhandled Promise rejections, React boundary errors, failed API requests and player failures. The web server records render/catalog failures; the API records exceptions producing 5xx responses.

Owners and administrators can use **User errors** in the administration app after MFA login. Filter by user ID, source, message, path, digest or browser session ID. Where available, `digest` correlates browser and server failures.

Events include server time, source, path, message, stack, error code, server-verified user ID, random browser session ID and up to ten navigation/request breadcrumbs. If the API is down, the website still writes events; user identity remains unconfirmed, and browser events can be correlated by session ID. Client-supplied user IDs are ignored.

Private JSONL files live at `artifacts/diagnostics/YYYY-MM-DD.jsonl`, excluded from Git and public routes. Retention is seven days, with a maximum of 4 MiB/day; old files are removed on a subsequent write. Browser duplicates are suppressed for five seconds. Limits are twenty events/minute per tab and 120 collection requests/minute per web process. The admin view returns the latest 100 matches.

Passwords, cookies, request bodies and localStorage contents are not collected. URL queries/fragments are discarded, and common secret/email patterns in messages and stacks are redacted. Application error messages should still avoid personal information.

For production, set the same absolute `DIAGNOSTICS_DIR` in the API, website and administration app and mount a shared private volume. Without it, each container stores only its own events. Collection limits apply per process across multiple replicas. A storage failure reports a short message to stderr without breaking the application.

The homepage retains its layout when the catalog is unavailable. Its collection retry button reissues the catalog request. The route error page uses Next.js `retry()` to refetch the failed segment.
