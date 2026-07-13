---
'@mastra/railway': patch
---

RailwaySandbox now keeps checkpoint-backed sandboxes alive across idle windows. When a `checkpointName` is configured, the pre-idle refresh pings the VM (resetting Railway's idle-destroy clock) before capturing the checkpoint, and reschedules itself each idle window. Every sandbox action debounces the timer, so the snapshot always lands just before the VM would otherwise be reclaimed.

When the refresh finds the VM gone or not running (e.g. the idle destroy raced the ping, or the timer fired late after host sleep — Railway's "Can only checkpoint a running sandbox" error), the sandbox now recovers itself: it reconnects and, when the VM is dead, re-creates it restored from the latest checkpoint, then resumes the keepalive loop instead of going dormant until the next action.

The keepalive also re-fetches the live sandbox status between the ping and the checkpoint (via `Sandbox.refresh()`), so a raced idle-destroy routes straight into recovery instead of failing the checkpoint call, and the lifecycle now emits diagnostics: refresh scheduling, late-firing timers (host sleep detection), ping/checkpoint timings, reconnect statuses, mid-operation restarts, and VM replacements (old id → new id).
