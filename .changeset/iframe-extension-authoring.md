---
'@getbrevo/cli': minor
---

`brevo app create` can author an **iframe extension**. The UI-app integration-type prompt offers *Iframe (Embeds your page in a modal)* next to *Link* — on a **private** app only, because iframe extensions are private-only in v1 — and the iframe branch asks for the embed URL (*Iframe URL — the page Brevo embeds in the modal*) and writes it to each entry's `modal_iframe_url` instead of `redirect_link`. Everything downstream already speaks the type: the upload diff has its `modal URL:` row, `link_target` is (correctly) never injected for it, and the created-app box prints the same placement summary.

The private-only rule is enforced in three places that say the same thing: the prompt hides the Iframe choice on a public app, `brevo app upload` refuses a hand-authored `iframeExtension` block on a public app locally before any round trip (`ui_app.extension_type "iframeExtension" requires distribution_type "private"`), and the platform 400s it at upload/create.

`yarn smoke --suite=ui` grows an iframe leg (create → upload no-op → install → uninstall → delete) that skips, rather than fails, on a build without the Iframe choice or an environment whose extension-point registry has no slot enabled for `iframeExtension` yet.

Iframe entries on widget slots can author `layout`: `"inline"` embeds the page directly in the widget card, `"modal"` (the default, never written) opens it from the card's CTA. `brevo app create` asks the question for iframe widget placements; the upload diff gains a `layout:` row; `validateUiApp` refuses the field on `actionLink` entries and pins the vocabulary.

Iframe entries that open a modal can also author `modal_size`: `"small"`, `"medium"` or `"large"` (the default, never written). `brevo app create` asks it whenever a modal actually opens — which is a different set of placements from the `layout` question's: an action slot's menu entry always opens one, a widget card only when its layout is `modal`. The upload diff, the created-app box and `brevo app install`'s summary all gain a `modal size:` row, and `validateUiApp` pins the vocabulary and refuses the field on `actionLink` entries.

`brevo app create` now refuses a `layout` it cannot honour instead of authoring it: a placement that renders no card is rejected by name (`ui_app.surface_point_list["<slug>"].layout …`) before the app is created, and a `--ui-config` file carrying `layout` or `modal_size` is rejected rather than silently dropped — both fields are `iframeExtension`-only and that route authors `actionLink`.

`brevo app upload` translates the platform's own layout refusal into a message that names the file and field to edit, keeping the server's sentence (which names the offending slots) inline. Only a `400` mentioning `layout` is relabelled; every other error keeps the server's own text.

`sandbox` joins `link_target`, `version` and `extension_point_name` as a server-stamped key stripped from `ui_app` echoes, so it never lands in `app-config.json` and never shows up as drift.
