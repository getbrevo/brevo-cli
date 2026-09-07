---
'@getbrevo/cli': patch
---

`brevo app create` can now create a **machine-to-machine (M2M)** OAuth app — one that uses the `client_credentials` grant, where your own server calls the Brevo API as itself with no Brevo user to redirect and no callback to register. Previously every OAuth app the CLI created was consent-based: it always collected a redirect URI and always sent `auth: { scopes, redirect_uris }`, so a server-to-server integration had to create a consent-based app and ignore half of it.

For a **private** OAuth app the interactive flow now asks *"Which OAuth flow does this app use?"* — *Consent Based* or *Machine to Machine* — after the app-type question and before any callback URL, because the answer decides whether a callback is asked for at all. Non-interactively, pass `--m2m --scopes "contacts:read,crm:read"`. M2M is private-only, `--scopes` is required with `--m2m`, and combining `--m2m` with `--redirect-uri`, `--ui-app`, `--ui-config` or `--distribution public` is refused before anything is created.

**M2M apps do not support scaffolding.** The command creates the app, prints the credentials and scopes, and stops — no project directory and no `app-config.json` are written, so `brevo app upload`, `brevo app scaffold` and `brevo app start` do not apply to one. Because there is no config to edit afterwards, an M2M app's scopes are fixed at creation; the credentials stay retrievable with `brevo app credentials --app-id <id> --reveal-secret`. Under `--json` the response carries `authType: "m2m"` and `scopes` and omits `redirectUri`, `directory` and `scaffolded` — `appType` stays `"oauth"`, since M2M is a flow within the OAuth app type rather than a third type.

Creating a consent-based OAuth app is unchanged, including the request body: it still sends no `auth.type` key at all, so nothing about the existing path moves.
