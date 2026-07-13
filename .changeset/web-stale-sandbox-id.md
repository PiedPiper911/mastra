---
'@mastra/code-sdk': patch
'mastracode-web': patch
---

Sessions no longer fail with a raw "Railway sandbox … is not running (status: DESTROYED)" error when their persisted sandbox id has gone stale. The workspace reattach seam now passes the GitHub project id along with the provider sandbox id, so when the id no longer matches any binding (the sandbox was re-provisioned or torn down since the session captured it), the web layer falls back to the project's binding row, reattaches to its current sandbox, and still recovers from the checkpoint when that VM is dead too.
