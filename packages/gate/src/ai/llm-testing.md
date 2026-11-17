Testing code that calls an LLM:
- Tests never call a real model and never assert on generated text.
- Test only the deterministic part: request and response schemas, tool handlers, retry, timeout, fallback, error mapping and refusals, with a fake client.
- What the model does goes in a separate eval of 5 to 20 cases, outside the unit suite and outside `vitest related`.
