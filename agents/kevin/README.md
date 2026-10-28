# agents/kevin

Kevin, the AI purchasing and inventory assistant: tool-use loop, prompts, tools. Design: docs/ARCHITECTURE.md.

- `src/forecast.ts`: the reorder forecast for one material at one plant. Need = planned batches in the horizon (default 10 days) × actual use per tablet at that plant; shortfall = need − on hand − on order; recommends a multiple of the reorder quantity when stock would fall below the reorder point. No LLM.
