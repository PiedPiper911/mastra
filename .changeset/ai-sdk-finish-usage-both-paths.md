---
'@mastra/ai-sdk': patch
---

Fix `convertMastraChunkToAISDKBase` to resolve `totalUsage` from `payload.usage` when the `output` wrapper is absent (e.g. synthesized finish chunks from `#broadcastPersistedSignal`), in addition to `payload.output.usage`. Previously usage was dropped for the non-wrapped path.
