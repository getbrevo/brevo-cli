---
'@getbrevo/cli': patch
---

The automatic retry on a `502 Bad Gateway` response now replays only idempotent requests (GET, PUT, DELETE). A 502 comes from a gateway, so the origin may already have processed the request — blindly replaying a create could duplicate the resource (observed: `brevo app create` producing two identical apps). POST and PATCH requests now surface the 502 as an error instead; if that happens on `app create`, check `brevo app list` before retrying, since the app may already exist.
