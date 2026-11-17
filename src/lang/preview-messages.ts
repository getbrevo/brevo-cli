import { CLI } from '../lib/constants';

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
  // merely unreachable.
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
    '5. The platform sets the iframe sandbox default. A private app may add permissions from the list the platform allows for the slot (including allow-same-origin, which the default no longer grants), by adding a "sandbox" string to the entry; anything else is refused.',
  ],
  // The iframe-permissions question in `app create` (BEX-498). Gated for the same reason as
  // the checklist: its only read sits behind `__BREVO_PREVIEW__` in `resolveUiApp`, so a
  // published build carries neither the question nor its text (`LEAK_STRINGS` asserts it).
  APP_CREATE_UI_SANDBOX_PROMPT: 'Does your page need extra iframe permissions?',
  APP_IFRAME_CHECKLIST_UPLOAD_HINT:
    'Before your iframe renders: your page must allow framing by non-same-origin parents (no X-Frame-Options DENY/SAMEORIGIN; frame-ancestors must allow the Brevo app origin). A blocked frame shows blank with no CLI error.',
  // ---- The iframe authoring surface (BEX-459) -------------------------------------
  // Moved here from `en.ts` so a published bundle does not carry copy for an unreleased
  // feature. Every read sits behind `__BREVO_PREVIEW__` (`build.mjs` fails a public build
  // otherwise), so on a published build the object is dropped and these never ship.
  // Asked only for an Iframe on a WIDGET slot (an action slot's menu entry must open
  // something, so it is always a modal). BOTH answers are written to the entry, the
  // default included: an authored `layout: "modal"` says in the file what an absent key
  // only implies, and a reader of app-config.json never has to know the fallback.
  APP_CREATE_UI_LAYOUT_PROMPT: 'How should it appear on the page?',
  APP_CREATE_UI_LAYOUT_MODAL: 'Opens in a modal (card button)',
  APP_CREATE_UI_LAYOUT_INLINE: 'Embedded directly on the page',
  // Modal size — asked for every iframe entry that actually OPENS a modal: an action
  // slot's menu entry always does, and a widget slot does too unless its layout answer
  // was `inline` (an inline card embeds the page in place and opens nothing). So the
  // gating is NOT the layout question's — that one is widget-only, this one is
  // "everything except inline".
  //
  // Large is the default and IS written to the entry, the same contract as the layout
  // question above: the entry records the size it opens at rather than implying it by an
  // absent key. The prompt pre-SELECTS it rather than listing it first, so a bare Enter
  // still lands on the platform's own default.
  APP_CREATE_UI_MODAL_SIZE_PROMPT: 'How big should the modal be?',
  APP_CREATE_UI_MODAL_SIZE_SMALL: 'Small',
  APP_CREATE_UI_MODAL_SIZE_MEDIUM: 'Medium',
  APP_CREATE_UI_MODAL_SIZE_LARGE: 'Large (default)',
  // Card height — asked for the one presentation where the card IS the embedded page:
  // an Iframe whose layout answer was `inline`. A modal sizes itself from `modal_size`
  // above, and every other placement keeps the silent seed, so this is the narrowest of
  // the three presentation questions.
  //
  // Carries its own example because the answer is a CSS length rather than a choice from
  // a list — the grammar (a positive integer with an explicit px or % unit) is not
  // guessable from a bare prompt, and the validator that enforces it is the one
  // `app upload` runs on the file. The slot's own `default_size.height` is pre-filled
  // where the registry declares one, so the example teaches the shape while the
  // pre-fill offers the platform's answer; a blank answer keeps that seed either way.
  APP_CREATE_UI_CARD_HEIGHT_PROMPT: 'Card height — how tall the embedded page is (e.g. 300px):',
  // The iframe counterpart of the redirect-link question: same slot in the flow, different
  // field — the answer lands in `iframe_href`, and the page opens INSIDE Brevo rather than
  // in a new tab, which is what the wording has to make unmistakable.
  //
  // Says "inside Brevo", not "in the modal": this question is asked BEFORE the layout one,
  // so at this point a widget placement may still turn out to be `inline`, which embeds the
  // page in the card and opens no modal. Naming the modal here would contradict the very
  // next question's own answer — and it is the same misnomer the `modal_iframe_url` →
  // `iframe_href` rename removed from the field.
  APP_CREATE_UI_IFRAME_HREF_PROMPT:
    'Iframe URL — the page Brevo embeds in the record (record context arrives as query params):',
  // The create-time counterpart of the platform's own refusal: `layout` is only
  // meaningful on a placement that renders a card, so stamping it onto a row that
  // renders none would author a block the upload endpoint 400s on. Named per entry, in
  // the `ui_app.surface_point_list["<slug>"].<field>` shape `validateUiApp` uses, so the
  // two refusals read the same whichever one a partner meets first.
  APP_CREATE_UI_LAYOUT_NOT_WIDGET: (slug: string) =>
    `ui_app.surface_point_list["${slug}"].layout cannot be authored on this placement — it renders no card, so there is nothing to embed inline. Only widget placements take a layout.`,

  // The platform's per-account Unleash rollout gate on iframe-extension authoring
  // (bo-be `app-store-bo-be-iframe-extension`, checked by `validateIframeDistribution`
  // alongside the private-only rule). Unlike that rule — which `uiAppType.validateConfig`
  // already catches locally before any round trip — the flag is per-account and the CLI
  // holds no copy of it (same reasoning as `isPublicDistributionRefusal` just above and
  // CLAUDE.md's standing rule), so this can only translate the server's answer.
  //
  // `Brevo said:` is deliberate, for the same reason `APP_CREATE_PUBLIC_REJECTED` quotes
  // it: if the platform ever rewords the rejection (and `isIframeExtensionDisabledRefusal`
  // stops recognising it), nothing is hidden in the meantime.
  APP_CREATE_UI_IFRAME_DISABLED: (serverMessage: string): string =>
    "This account can't create iframe extensions yet — Brevo rejected this request.\n\n" +
    '  Do this:     choose Link instead, or ask Brevo to enable iframe extensions for this account\n' +
    `  Brevo said:  ${serverMessage}`,

  // Whether a slot renders a card is a REGISTRY fact, and the CLI deliberately holds no
  // copy of the registry (see CLAUDE.md) — so `layout: "inline"` on a slot that renders
  // none can only be caught server-side. This translates that refusal into a message that
  // says what to edit, rather than leaving the partner with the wire's own sentence.
  //
  // Narrow on purpose, exactly like `isPublicDistributionRefusal` in `app create`: only a
  // 400 that names `layout` is relabelled, so an unrelated 400 keeps the server's own
  // text. The server's sentence is kept inline because it names the offending slot(s).
  APP_UPLOAD_UI_LAYOUT_REJECTED: (serverMessage: string) =>
    `Brevo rejected this app's iframe layout: ${serverMessage}\n  \`layout: "inline"\` only works on a placement that renders a card. Remove \`layout\` from that \`surface_point_list\` entry in app-config.json (or set it to "modal"), then run \`${CLI.APP_UPLOAD}\` again.`,
  // The platform's per-account Unleash rollout gate on iframe-extension authoring — see
  // `APP_CREATE_UI_IFRAME_DISABLED` for why this is a translation, not a local guard.
  // Reaches an existing app on its first upload that switches `extension_type` to
  // `iframeExtension`, since that combination cannot have been created in the first place
  // while the flag was off.
  APP_UPLOAD_UI_IFRAME_DISABLED: (serverMessage: string) =>
    `Brevo rejected this app's iframe extension: ${serverMessage}\n  Iframe extensions are still rolling out; ask Brevo to enable them for this account, or set \`extension_type\` to "actionLink" in app-config.json and run \`${CLI.APP_UPLOAD}\` again.`,
} as const;
