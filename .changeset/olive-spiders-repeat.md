---
'@getbrevo/cli': patch
---

Fix two ways the update banner could show local wording when the app-store service had wording of its own.

**`--help` and `--version` never asked.** They are exempt from the `is_blocked` gate so a blocked CLI can still say what version it is — but that was implemented by skipping the whole `/cli/info` call, which discarded the message along with the verdict. Both still render an update banner, so the two commands people most often run to check their version were the only ones that could never explain why the version mattered. The exemption now covers the block alone: they fetch the wording, show it, and still exit `0` no matter what `is_blocked` says.

**The 15-minute cache ignored which service the answer came from.** The entry was keyed on `cliVersion` and `lastChecked` only, but the base URL is overridable per-invocation via `BREVO_APP_STORE_URL`, so two runs against different environments shared one entry — whichever was hit first answered for both until the TTL expired. The symptom was badly misleading: pointing at staging rendered the message production had returned moments earlier and vice versa, so the CLI and a direct `curl` disagreed, and which environment looked broken depended only on the order the two were run in. `baseUrl` is now part of the key. An entry written before the field existed fails the shape check and is treated as a miss, so an upgrade re-fetches once rather than serving a stale answer.

Neither changes what blocks, what fails open, or any exit code.
