---
'@getbrevo/cli': patch
---

Internal: hardened scaffold test fixtures by replacing hardcoded `/tmp/...` paths with `os.tmpdir()` to address SonarCloud `S5443` findings (publicly-writable directories). Test-only change — no runtime behavior is affected.
