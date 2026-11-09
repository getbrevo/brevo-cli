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
} as const;
