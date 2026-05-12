---
'@getbrevo/cli': patch
---

Internal: hardened scaffold test fixtures by routing the mocked `outputDir` strings through a sandbox path under `__dirname` instead of `os.tmpdir()` / hardcoded `/tmp/...`. Addresses SonarCloud `S5443` (publicly-writable directories) at all 9 callsites. Test-only change — no runtime behavior is affected.
