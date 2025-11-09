---
layout: post
title:  "Building a Multi-Agent AI Code Review System: When Two Brains Are Better Than One"
date:   2025-01-09 00:00:00 -0700
categories: ai agents claude gemini code-review
---

What if you could get two completely different AI perspectives on your pull requests, running in parallel, and then have a third AI synthesize their insights into a single, actionable report? Sounds ambitious? It's actually straightforward. I just built it using Claude Skills, and it took less time than you'd think.

## The Problem: Every AI Has Blind Spots

I've been using AI for code reviews for a while now, and I noticed something interesting: different AI models catch different things. Claude excels at spotting architectural issues and security vulnerabilities. Gemini is phenomenal at catching edge cases and subtle logic bugs. But getting both perspectives meant running two separate reviews and manually comparing them. That's... tedious.

What if they could work together?

## Enter: Claude Skills and Multi-Agent Orchestration

Claude recently introduced [Skills](https://www.anthropic.com/news/skills) - a way to teach Claude specialized workflows using simple markdown files. Think of them as reusable instruction sets that Claude can load dynamically when needed. The genius part? Skills can coordinate multiple agents working in parallel.

I built a multi-agent PR review system that:
1. **Spawns two review agents in parallel** - one using Claude, one calling Gemini via CLI
2. **Lets each agent independently fetch PR data** from GitHub
3. **Synthesizes their findings** using a third comparison agent
4. **Generates a unified report** showing consensus issues, unique insights, and even disagreements

The whole thing runs as a single slash command.

## How It Works: Architecture in 60 Seconds

The system has four components:

**Main Orchestrator** - Validates the PR and coordinates the workflow
**Claude Review Agent** - Focuses on architecture, security (OWASP Top 10), design patterns
**Gemini Review Agent** - Focuses on bugs, edge cases, performance, algorithmic correctness
**Comparison Agent** - Synthesizes both reviews, identifies patterns, resolves contradictions

Here's the directory structure:

```
.claude/skills/pr-review-comparison/
├── SKILL.md                    # Orchestrator
├── claude-review/
│   └── SKILL.md               # Claude's perspective
├── gemini-review/
│   ├── SKILL.md               # Gemini's perspective
│   └── scripts/
│       └── gemini_review.sh   # Shell script wrapper
└── review-comparison/
    └── SKILL.md               # Synthesis agent
```

Each component is autonomous. The Claude agent doesn't know about Gemini, and vice versa. They each fetch the PR independently using `gh` commands, analyze it from their unique perspective, and return structured markdown reviews.

## The Magic: Progressive Disclosure and Parallel Execution

What makes this elegant is **progressive disclosure** - Claude only loads skill instructions when relevant. Each skill has a tiny metadata file:

```json
{
  "name": "comparing-ai-pr-reviews",
  "description": "Orchestrates parallel code reviews from Claude and Gemini..."
}
```

When you type `/review-compare 42`, Claude:
1. Scans available skills
2. Finds the match
3. Loads the full instructions
4. Spawns agents in parallel (not sequentially!)
5. Collects results
6. Runs synthesis

The parallel execution is key - instead of 90s + 90s = 180s, it's more like 90s total. Time savings: ~40%.

## What the Output Looks Like

The comparison report is opinionated and actionable:

```markdown
# PR Review Comparison Report

## Executive Summary
12 issues found (3 Critical, 4 High, 3 Medium, 2 Low)
Review time: Claude 45s | Gemini 38s

## Consensus Issues (High Confidence)
Both AIs identified these - fix these first:
- SQL Injection vulnerability at `queries.ts:28`
- Missing error handling at `handlers.ts:15`

## Claude-Specific Insights
Unique architectural findings:
- Violation of single responsibility principle...

## Gemini-Specific Insights
Unique correctness findings:
- Edge case: function fails when array is empty...

## Contradictions
Claude says: Extract method (Medium priority)
Gemini says: Inline is clearer here
Analysis: [synthesis]

## Final Recommendation: REQUEST CHANGES
```

## The Fun Part: It Disagrees With Itself (Sometimes)

One of my favorite features is the **Contradictions** section. Sometimes Claude and Gemini genuinely disagree - maybe Claude wants you to extract a method for readability, while Gemini thinks the current inline approach is clearer.

The comparison agent doesn't pick sides arbitrarily. It presents both perspectives with reasoning, then offers a balanced synthesis. It's like having two senior engineers debate in your PR comments, but without the ego.

## Three Slash Commands, Infinite Possibilities

I created three slash commands:

```bash
/review-compare 42    # Both AIs + comparison
/review-claude 42     # Claude only
/review-gemini 42     # Gemini only
```

The skills are composable - you can invoke them individually or let the orchestrator coordinate them. Want just Gemini's take? Done. Want the full comparison? One command.

## Why This Matters Beyond Code Reviews

This isn't really about code reviews. It's about **multi-agent orchestration patterns**. The same architecture could apply to:

- **Content creation** - One agent for technical accuracy, another for readability, a third to synthesize
- **Data journalism** - Multiple agents fetching different datasets, one synthesizing the story
- **Research** - Parallel agents exploring different sources, comparison agent finding patterns

The key insight: **agents with different strengths, working independently, synthesized by a neutral coordinator**. That's the pattern.

## What I Learned Building This

**1. Skills are just markdown files**
No complex API. No plugin architecture. Just instructions in markdown. This is intentionally low-friction.

**2. Autonomous agents > micromanaged agents**
Letting each agent fetch its own data (via `gh` commands) is cleaner than pre-fetching and passing context around. Trust the agents.

**3. Separation of contexts is a feature**
Running Gemini in a separate process via shell script means completely independent analysis. No context bleeding. True diversity of thought.

**4. Progressive disclosure prevents context overload**
Skills aren't loaded until needed. The orchestrator stays lightweight. This scales.

## Try It Yourself

The complete implementation is in my `.claude/skills/pr-review-comparison/` directory. It requires:
- GitHub CLI (`gh`) - for fetching PRs
- Gemini CLI (optional) - for dual reviews

You can start with just Claude reviews, then add Gemini later. The system degrades gracefully.

## What's Next?

I'm thinking about:
- Adding GPT-4 as a third perspective
- Tracking review accuracy over time (which AI catches real bugs?)
- Webhook integration for automatic PR reviews on push
- Team-specific customization (different orgs have different priorities)

But honestly? The current version already saves me 20+ minutes per PR review. That's enough.

## The Bigger Picture

We're entering an era where **coordination** matters more than individual capability. A single frontier model is impressive. But multiple specialized agents, working in concert, each bringing unique strengths? That's when things get interesting.

The code review system I built isn't about replacing human reviewers. It's about giving them better information faster. Two AI perspectives, synthesized intelligently, surfacing consensus issues with high confidence and flagging disagreements for human judgment.

That's the future I want: AI agents collaborating, not competing. Each doing what they do best, coordinated by thoughtful orchestration.

And it all starts with a simple markdown file.

---

*Want to build your own multi-agent workflows? Check out [Claude Skills documentation](https://docs.claude.com/en/docs/agents-and-tools/agent-skills) and the [awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) repository for inspiration.*
