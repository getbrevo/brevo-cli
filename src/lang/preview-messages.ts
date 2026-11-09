/**
 * User-facing strings for features that have not shipped.
 *
 * Split out of `en.ts` for a build reason, not a tidiness one. `messages` is a single
 * object literal, and esbuild cannot prune properties from one — so with a gated string
 * inline, it would ship in the published bundle even though no surviving code references
 * it. As a separate module spread in behind `__BREVO_PREVIEW__`, the object becomes
 * unreachable and the bundler drops it.
 *
 * `en.ts` types the spread as `typeof previewMessages`, so every call site stays
 * type-safe. That is a deliberate lie about the runtime shape, and a safe one: the only
 * code reading these keys lives behind `__BREVO_PREVIEW__`, so nothing can observe the
 * absence.
 *
 * At GA, move the released strings back into `en.ts` and delete this file when it
 * empties.
 */
export const previewMessages = {
  // The *Iframe* choice in `app create`'s UI-app integration-type prompt (BEX-459). Here
  // rather than in `en.ts` for the same build reason: the only read sits inside
  // `promptIntegrationType`'s `__BREVO_PREVIEW__` branch, so on a published build the
  // branch is eliminated and this string is genuinely absent from the bundle rather than
  // merely unreachable. The other iframe strings stay in `en.ts` — live code (`app
  // upload`'s refusal translation, the renderers) reads them in every build.
  APP_CREATE_UI_INTEGRATION_MODAL_IFRAME: 'Iframe (Embeds your page in a modal)',

  // The framing/CSP checklist (BEX-498), printed after a successful iframe create and
  // pointed to after an iframe upload. Here, not in `en.ts`, because it names the gated
  // feature: both read sites sit behind `__BREVO_PREVIEW__`, so a published build drops the
  // strings entirely (`LEAK_STRINGS` asserts it). Deliberately generic about origins — it
  // says "Brevo's app origin" and names no hostname, because the CLI cannot know which
  // origin(s) a given environment frames from.
  APP_IFRAME_CHECKLIST_TITLE: 'Before your iframe renders',
  APP_IFRAME_CHECKLIST_LINES: [
    "Your page loads inside a frame on Brevo's app origin. A frame the browser blocks shows blank, with no error in the CLI.",
    '',
    '1. Do not send X-Frame-Options: DENY or SAMEORIGIN.',
    "2. If you send a Content-Security-Policy, frame-ancestors must allow Brevo's app origin(s) or be omitted.",
    '3. iframe_href must be an absolute https:// URL, not an IP address or localhost.',
    '4. Do not rely on third-party cookies inside the frame; read the record identifiers from the query parameters. Cookies need SameSite=None; Secure to be sent at all, and Safari and Firefox still block or partition third-party cookies, so a cookie session may fail for some users. Pass state in the query parameters or a short-lived token instead.',
    '5. The platform sets the iframe sandbox. It cannot be authored in app-config.json.',
  ],
  APP_IFRAME_CHECKLIST_UPLOAD_HINT:
    'Before your iframe renders: your page must allow framing by non-same-origin parents (no X-Frame-Options DENY/SAMEORIGIN; frame-ancestors must allow the Brevo app origin). A blocked frame shows blank with no CLI error.',
} as const;
