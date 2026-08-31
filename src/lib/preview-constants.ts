/**
 * Command references and endpoints for features that have not shipped (BEX-405).
 *
 * Split out of `constants.ts` for the same build reason `preview-messages.ts` was split
 * out of `en.ts`: `CLI` and `ENDPOINTS` are each a single object literal, and esbuild
 * cannot prune properties from one — so with these inline, `brevo app submit --app-id
 * <id>`, `brevo app withdraw --app-id <id>`, `brevo app status` and the `/withdraw` and
 * `/state` paths all shipped in the published bundle at zero references. Nothing could
 * reach them (no command is registered, no help lists them), but `strings` on the
 * published binary read back the names of three unreleased commands — which is exactly
 * what the build-level gate exists to prevent. As separate objects spread in behind
 * `__BREVO_PREVIEW__`, they become unreachable and the bundler drops them.
 *
 * `constants.ts` types each spread as `typeof previewCli` / `typeof previewEndpoints`
 * even when it is empty, so every call site stays type-safe. That is a deliberate lie
 * about the runtime shape, and a safe one for the same reason it is safe in `en.ts`:
 * the only code reading these keys (`commands/app/submit.ts`, `status.ts`, `withdraw.ts`
 * and `appService.fetchAppState` / `withdrawApp`) lives in modules eliminated alongside
 * them, so nothing can observe the absence.
 *
 * At GA, move these back into `constants.ts` and delete this file when it empties.
 * See `RELEASE-CHECKLIST.md`.
 */

// Read only by `lang/preview-messages.ts` and `commands/app/withdraw.ts`.
export const previewCli = {
  APP_STATUS: 'brevo app status',
  APP_WITHDRAW: (appId?: string): string =>
    appId ? `brevo app withdraw --app-id ${appId}` : 'brevo app withdraw --app-id <id>',
  APP_SUBMIT: (appId?: string): string =>
    appId ? `brevo app submit --app-id ${appId}` : 'brevo app submit --app-id <id>',
} as const;

// Read only by `appService.fetchAppState` (the state read behind `app status` /
// `app submit`) and `appService.withdrawApp`.
export const previewEndpoints = {
  APP_STATE: (appId: string): string => `/v3/app-store/apps/${encodeURIComponent(appId)}/state`,
  APP_STORE_APP_WITHDRAW: (appId: string): string =>
    `/v3/app-store/apps/${encodeURIComponent(appId)}/withdraw`,
} as const;
