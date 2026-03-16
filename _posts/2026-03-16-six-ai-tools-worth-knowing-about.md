---
layout: post
title:  "Six open-source AI tools I researched this week, from swarm prediction engines to $100 ChatGPTs"
date:   2026-03-16 00:00:00 -0700
categories: ai tools research open-source
---

I spent an afternoon digging into six AI projects that kept showing up in my feeds. Some are directly useful for my Claude Code workflow, others are fascinating for entirely different reasons. Here's what I found.

## Agency Agents: 147 AI personas you can drop into Claude Code

[Agency Agents](https://github.com/msitarzewski/agency-agents) by Michael Sitarzewski is a collection of 147 agent personas across 12 divisions - engineering, design, marketing, product, QA, support, spatial computing, and more. Each agent is a markdown file with a distinct personality, processes, and deliverables. The repo hit 10,000 GitHub stars in its first week.

The install for Claude Code is one command:

```bash
git clone https://github.com/msitarzewski/agency-agents.git
cd agency-agents
./scripts/install.sh --tool claude-code
```

Agents land in `~/.claude/agents/` and Claude Code auto-detects them as subagents. When it encounters a task matching an agent's description, it delegates. No conversion step needed - Claude Code reads native `.md` files.

I initially thought [Kilo CLI](https://kilo.ai/) wasn't supported - it isn't listed in the install script. But then I realized Kilo CLI is a fork of [OpenCode](https://github.com/opencode-ai/opencode), which Agency Agents _does_ natively support. Kilo CLI scans `.opencode/agents/` directories alongside its native `.kilo/agents/` paths for backward compatibility. So the OpenCode install works with zero modifications:

```bash
./scripts/install.sh --tool opencode
```

This drops the agent files into `.opencode/agents/` in your project, and Kilo CLI picks them up automatically. If you prefer the canonical Kilo location, copy them to `.kilo/agents/` or `~/.config/kilo/agents/` instead.

## MiroFish: simulating thousands of AI agents to predict the future

This one is wild. [MiroFish](https://github.com/666ghj/MiroFish) is a swarm intelligence prediction engine built by Guo Hangjiang, an undergrad at Beijing University of Posts and Telecommunications. He reportedly built it in 10 days using vibe coding. It secured ~$4M investment from Shanda Group's founder.

The pipeline works like this:

1. Feed it a document - news article, financial report, policy draft, whatever
2. GraphRAG parses the input, extracts entities and relationships, builds a knowledge graph
3. The system spawns _thousands_ of autonomous AI agents, each with an independent persona and long-term memory
4. Agents interact on simulated social platforms - a Twitter-like feed, Reddit-like forums
5. Social dynamics emerge and the system produces a prediction report

The use cases range from financial forecasting to PR crisis simulation to academic research.

One catch: MiroFish expects the OpenAI SDK format for its LLM backend. If you want to use a Claude API key, you need a translation proxy like [LiteLLM](https://docs.litellm.ai/docs/providers/anthropic):

```env
LLM_API_KEY=sk-ant-your-anthropic-key
LLM_BASE_URL=http://localhost:4000/v1
LLM_MODEL_NAME=claude-sonnet-4-20250514
```

Direct Anthropic API key usage won't work without that intermediary.

## Impeccable: teaching AI tools what good design actually looks like

[Impeccable](https://github.com/pbakaus/impeccable) by Paul Bakaus (jQuery UI creator, ex-Google Chrome DevTools) solves a specific problem: every LLM learned from the same generic templates, so AI-generated UI defaults to Inter font, purple gradients, and cards nested inside cards.

Impeccable is not a component library. It's a **vocabulary and pattern layer** - 1 skill with 7 reference files covering typography, OKLCH color, spatial design, motion, interaction, responsive design, and UX writing. It ships 17 slash commands like `/audit`, `/polish`, `/bolder`, and `/distill`.

Install:

```bash
npx skills add pbakaus/impeccable
```

It auto-detects your AI harness. Works with Claude Code, Cursor, Gemini CLI, and Codex CLI. I like this approach _a lot_ - rather than building yet another UI framework, it upgrades the taste of the AI tools you already use.

## OpenViking: a filesystem-style context database for AI agents

[OpenViking](https://github.com/volcengine/OpenViking) by ByteDance's Volcengine Viking team replaces fragmented vector-based RAG with a filesystem paradigm. All agent context - memory, resources, skills - lives under `viking://` URIs and gets retrieved with `ls`, `find`, `grep`-like commands.

The three-tier context structure is the interesting part:

- **L0**: Abstracts (~100 tokens)
- **L1**: Overviews (~2k tokens)
- **L2**: Full details

Context loads on demand. ByteDance claims this is ~95% cheaper than dumping full context into every call.

For Claude Code, there's an official `claude-memory-plugin` at `examples/claude-memory-plugin` in the repo. It hooks into Claude Code's lifecycle events - `session-start.sh`, `user-prompt-submit.sh`, `stop.sh`, `session-end.sh`. At session end, it calls `session.commit()` to trigger OpenViking's memory extraction pipeline. A `memory-recall` skill retrieves relevant past context on the next prompt submission.

```bash
uv pip install openviking --upgrade --force-reinstall
```

One important note: **CVE-2026-22207** affects versions through 0.1.18. If you omit the `root_api_key` config, unauthenticated attackers can gain ROOT privileges. Set that key.

No Kilo CLI integration exists.

## Heretic: automatic censorship removal for open-weight LLMs

[Heretic](https://github.com/p-e-w/heretic) by Philipp Emanuel Weidmann finds the mathematical "refusal direction" in a model's activation space and cancels it - no fine-tuning required. It trended #1 on GitHub in November 2025.

The technique - directional ablation combined with a TPE-based Optuna optimizer - co-minimizes two objectives: the number of refusals _and_ KL divergence from the original model. So the decensored model retains as much of the original intelligence as possible.

```bash
uv pip install -U heretic-llm
heretic Qwen/Qwen3-4B-Instruct-2507
```

That's it. ~45 minutes for an 8B model on an RTX 3090. Supports `bnb_4bit` quantization to reduce VRAM.

The Gemma results are particularly strong. On Gemma-3-12B, the Heretic version achieved a **3/100 refusal rate** with KL divergence of only **0.16** - compared to 0.45-1.04 for hand-tuned approaches. Pre-built models like `p-e-w/gemma-3-12b-it-heretic` are on HuggingFace.

**No AWS Bedrock connection exists.** Heretic modifies open-weight model files locally on GPU hardware. Bedrock serves managed proprietary endpoints - fundamentally incompatible with weight-level modification. This tool is for local and self-hosted open models only.

## nanochat: Karpathy's $100 ChatGPT from scratch

[nanochat](https://github.com/karpathy/nanochat) by Andrej Karpathy is the successor to nanoGPT. Tagline: "The best ChatGPT that $100 can buy." It's a full-stack training and inference pipeline covering every modern LLM stage:

1. Tokenizer training (Rust)
2. Base pretraining
3. Mid-training on chat data
4. Supervised fine-tuning
5. Optional RL on GSM8K
6. Evaluation
7. Web-based chat UI

The entire pipeline runs as a "speedrun" on a single 8xH100 node. The design has one dial of complexity: transformer depth. That single integer auto-determines all other hyperparameters - model size, learning rate, batch size - so the trained model comes out compute-optimal.

The cost breakdown: **$48** (~2 hours on 8xH100) for a GPT-2-class model. **~$15** on spot instances. At **$100** you get stories, poems, simple Q&A. At **$1,000** (~41.6 hours) it handles basic math and code.

The whole thing is ~8,000 lines of Python and Rust. It serves as the capstone project for Karpathy's LLM101n course at Eureka Labs. Community extensions already include [nanochat-VLM](https://github.com/Masoudjafaripour/nanochat-VLM) for vision/multimodal (under $200 compute) and [nanochat-rs](https://github.com/AntigmaLabs/nanochat-rs), a Rust reimplementation.

## What stands out

The tools I'll actually integrate into my workflow: **Agency Agents** for Claude Code subagents, **Impeccable** for UI generation quality, and **OpenViking** for persistent agent memory across sessions.

MiroFish and nanochat are fascinating for different reasons - one simulates entire social ecosystems for prediction, the other demystifies the full LLM stack for ~$100. Heretic is a sharp research tool for anyone working with open-weight models locally.

The common thread: all six projects are open-source, all launched in the last few months, and all address gaps that the major AI platforms haven't filled yet.
