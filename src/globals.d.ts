/**
 * Build-time globals substituted by esbuild (BEX-405).
 *
 * `__BREVO_PREVIEW__` is replaced with the literal `true` or `false` at every use site
 * before parsing — see `define` in `scripts/build.mjs`. It is never a real global at
 * runtime in a published build, because no reference to it survives substitution.
 *
 * **Why a bare global and not just the exported `PREVIEW_BUILD` constant?** Because
 * esbuild folds a constant within the module that declares it but does *not* propagate
 * it across module boundaries. `PREVIEW_BUILD` correctly becomes `false` inside
 * `lib/build-flags.js`, yet an importing module still emits
 * `PREVIEW_BUILD ? previewAppCommands : []` as a runtime ternary — which keeps
 * `previewAppCommands` live and ships every gated command. Substituting a global
 * instead makes the fold local to each use site, so the dead branch and everything it
 * referenced can actually be eliminated. This was verified by inspecting the bundle,
 * and `scripts/build.mjs` asserts it on every public build.
 *
 * Use `PREVIEW_BUILD` from `lib/build-flags` for ordinary branching. Reach for this
 * global only where the goal is *elimination* — dropping a module or a block of help
 * text from the published bundle — and say so in a comment at the site.
 *
 * Under jest nothing is substituted, so `jest.setup.js` defines it on `globalThis`.
 *
 * Declared `var` rather than `const` so it is reachable as `globalThis.__BREVO_PREVIEW__`,
 * which is how the setup file assigns it and how the gate's tests flip build states
 * between `jest.isolateModules` re-imports. In a real build the name never survives
 * substitution, so the mutability this implies exists only under test.
 */
// eslint-disable-next-line no-var
declare var __BREVO_PREVIEW__: boolean;
