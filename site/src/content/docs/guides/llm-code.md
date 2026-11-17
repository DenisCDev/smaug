---
title: Code that uses an LLM
description: How Smugan detects AI engines and models and researches a guide for each pair.
---

When the project uses an AI engine (an SDK, an agent framework, a runtime pinned in
an image) or writes a model id in the code, Smugan identifies the engine + model
pairs and the version of each, reading only from disk. The detector knows names and
patterns, listed in `packages/gate/src/ai/signatures.json`; adding an engine or model
is one entry in that file. Smugan ships no guide or best practice for any engine or
model.

A pair's guide is researched the first time a turn edits code that uses a pair
without a valid guide: the hook asks for delegation to the `smugan-ai-research`
subagent, which confirms the pair in the repository, reads only official
documentation and releases and saves up to 400 words with the sources. The guide is
valid for 30 days and lives in `~/.smugan/ai-guides/`, outside the checkout. At the
start of each session, the hook injects the guide index as reference material, and
the LLM testing rules come in only for projects that use an LLM: no real model and no
generated text in unit tests, only the deterministic part, and model behavior in a
separate eval. Details are in the
[engine documentation](https://github.com/DenisCDev/smugan/blob/main/packages/gate/README.md#ai-guides-per-engine--model-pair).
