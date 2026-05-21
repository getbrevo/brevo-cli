---
'@getbrevo/cli': minor
---

`brevo app scopes --web` opens a styled browser view (BEX-197):

- Passing `--web` starts a short-lived loopback HTTP server on `127.0.0.1` and opens the user's browser to a self-contained HTML page listing every supported scope grouped by category, with a search filter. Each scope is expandable to reveal its API endpoints (chip list). The terminal still prints the grouped list as before. The local server runs in the foreground until Ctrl+C (SIGINT or SIGTERM closes it cleanly).
- A "Refresh" button on the page re-fetches scopes from the IdP (via `/scopes.json` on the local server) without restarting the command.
- Without `--web` the command exits after printing the list — TTY detection no longer triggers the browser. `--json` continues to suppress the browser and exits after emitting JSON.
