---
layout: post
title:  "Running Claude and Gemini code reviews in parallel with a third AI to compare them"
date:   2025-01-09 00:00:00 -0700
categories: ai agents claude gemini code-review
---

I built a system that runs Claude and Gemini code reviews simultaneously on the same pull request, then uses a third AI agent to synthesize their findings. The whole thing executes as a single slash command and typically completes in under two minutes.

The comparison reports are genuinely useful—not because either model is perfect, but because they consistently catch different categories of issues.

## Different models find different bugs

I've been experimenting with AI-assisted code reviews for several months. One pattern emerged quickly: Claude tends to flag architectural problems and security vulnerabilities (SQL injection, XSS, authentication bypasses). Gemini catches more edge cases and logic errors (off-by-one, null pointer exceptions, race conditions).

Running both reviews manually meant copying PR URLs between tools, waiting for sequential execution, then manually correlating their findings. This took 5-10 minutes per review—tedious enough that I'd skip it for smaller PRs.

I wanted both perspectives without the overhead.

## Claude Skills enable multi-agent orchestration

Anthropic released [Skills](https://www.anthropic.com/news/skills) recently—a system for defining reusable agent workflows in markdown files. The key feature: Skills can spawn multiple independent agents that execute in parallel.

I created four coordinated agents:

1. **Orchestrator**: Validates the PR number and coordinates execution
2. **Claude reviewer**: Analyzes architecture, security (OWASP Top 10), design patterns
3. **Gemini reviewer**: Focuses on correctness, edge cases, performance
4. **Comparison agent**: Synthesizes both reviews, identifies consensus and contradictions

The architecture looks like this:

```
.claude/skills/pr-review-comparison/
├── SKILL.md                    # Orchestrator
├── claude-review/
│   └── SKILL.md               # Claude's analysis
├── gemini-review/
│   ├── SKILL.md               # Gemini's analysis
│   └── scripts/
│       └── gemini_review.sh   # Shell wrapper for Gemini CLI
└── review-comparison/
    └── SKILL.md               # Synthesis agent
```

Each agent operates autonomously. They don't share context—each fetches the PR independently using `gh api` commands and produces a standalone review in markdown. This isolation is intentional. I wanted genuinely independent analysis, not correlated outputs where one model's assessment influences the other.

## Progressive disclosure keeps context manageable

Skills use a two-stage loading mechanism. Each skill defines minimal metadata:

```json
{
  "name": "comparing-ai-pr-reviews",
  "description": "Orchestrates parallel code reviews from Claude and Gemini..."
}
```

Claude scans these metadata files but doesn't load the full instructions until the skill is invoked. When you run `/review-compare 42`, Claude:

1. Matches the command to the skill
2. Loads the orchestrator instructions
3. Spawns Claude and Gemini agents in parallel
4. Waits for both to complete
5. Passes their outputs to the comparison agent
6. Returns the synthesized report

Parallel execution matters here. Sequential execution would take ~90 seconds (Claude) + ~90 seconds (Gemini) = 180 seconds. Parallel execution completes in roughly 95 seconds—the duration of the slower agent plus synthesis overhead.

## The comparison reports surface consensus and disagreement

Here's an actual comparison report from a recent PR (anonymized):

```markdown
# PR Review Comparison Report

## Executive Summary
9 issues found: 2 Critical, 3 High, 3 Medium, 1 Low
Claude review: 47s | Gemini review: 41s | Comparison: 8s

## Consensus Issues (Both AIs Agree)
Fix these first—high confidence findings:

1. **SQL Injection** (Critical) - `queries.ts:28`
   User input concatenated directly into query string
   Both AIs: Use parameterized queries

2. **Missing Error Handling** (High) - `handlers.ts:15`
   Unhandled promise rejection crashes server
   Both AIs: Add try-catch or .catch() handler

## Claude-Specific Findings
Architectural concerns unique to Claude:

3. **Single Responsibility Violation** (Medium) - `UserService.ts:45-89`
   Method handles validation, persistence, and email notifications
   Recommendation: Extract notification logic to separate service

## Gemini-Specific Findings
Correctness issues unique to Gemini:

4. **Array Empty Edge Case** (High) - `utils.ts:34`
   Function assumes non-empty array, fails with `undefined` on `arr[0]`
   Recommendation: Add guard clause or default value

## Contradictions
Cases where AIs disagree:

5. **Method Extraction** - `formatters.ts:22-35`
   - Claude: Extract 14-line formatting block to separate method (Medium)
   - Gemini: Current inline approach is clearer given single usage
   - Analysis: Single call site favors inline. If usage expands, extract then.

## Recommendation: REQUEST CHANGES
Critical issues (SQL injection) block merge. High-priority items should be addressed before approval.
```

The **Contradictions** section is my favorite feature. When the models genuinely disagree—usually on subjective issues like code organization—the comparison agent presents both perspectives with reasoning. It doesn't arbitrarily pick sides.

I've found these disagreements often indicate legitimately ambiguous design decisions where human judgment matters most.

## Three commands, composable workflows

I created three slash commands as thin wrappers:

```bash
/review-compare 42    # Dual review + comparison
/review-claude 42     # Claude only
/review-gemini 42     # Gemini only
```

The skills are independently invocable. Sometimes I want just one model's perspective. Sometimes I want the full comparison. The orchestrator coordinates them when needed, but they work standalone.

## Implementation details: keeping agents isolated

The Gemini integration runs in a separate process via shell script:

```bash
#!/bin/bash
# gemini_review.sh

PR_NUMBER=$1
gh api "repos/:owner/:repo/pulls/$PR_NUMBER" > /tmp/pr_$PR_NUMBER.json

gemini-cli prompt "
Review this pull request for correctness and edge cases:
$(cat /tmp/pr_$PR_NUMBER.json)

Focus on:
- Logic errors and edge cases
- Null/undefined handling
- Algorithmic correctness
- Performance concerns
"
```

This process isolation means Gemini's analysis happens in a completely separate context from Claude's. No shared memory, no context bleeding. The comparison agent only sees the final markdown outputs.

I initially tried passing PR data as context to both agents, but that introduced correlation—both models saw identical formatted context. Letting each agent fetch its own data via `gh` commands produces more diverse analysis.

## What this cost to build

The entire system took about 4 hours to build:

- 1 hour: Initial orchestrator and Claude reviewer
- 1 hour: Gemini CLI integration and shell script debugging
- 1.5 hours: Comparison agent prompt engineering
- 0.5 hours: Testing and refinement

Total lines of markdown (excluding documentation): ~450 lines across four skill files.

No custom API integrations. No complex frameworks. Just markdown instructions that Claude interprets.

## Accuracy tracking: which model catches real bugs?

I've run this on 23 PRs so far. I tracked which flagged issues were actually fixed:

| Issue Type | Claude Found | Gemini Found | Both Found | Fix Rate |
|------------|--------------|--------------|------------|----------|
| Security   | 8            | 2            | 3          | 100%     |
| Logic bugs | 4            | 11           | 2          | 76%      |
| Architecture | 15         | 3            | 1          | 31%      |
| Style/readability | 12   | 8            | 0          | 18%      |

Security issues flagged by either model have been fixed 100% of the time—these are true positives. Logic bugs have a 76% fix rate. Architectural suggestions get implemented 31% of the time, likely because they're more subjective.

Style and readability suggestions have an 18% fix rate, suggesting these might be noise. I'm considering filtering them from future reports.

## Multi-agent patterns beyond code review

This architecture generalizes beyond code review. The pattern is: **multiple specialized agents analyzing independently, synthesized by a neutral coordinator**.

I'm experimenting with:

- **Content editing**: One agent for technical accuracy, another for readability, synthesis agent balancing both
- **Research synthesis**: Multiple agents fetching different data sources, comparison agent finding patterns across datasets
- **Security analysis**: Agents with different threat models (confidentiality, integrity, availability), synthesis agent prioritizing findings

The key insight: diversity matters more than individual capability. Two specialized agents with different strengths, independently analyzing the same input, produce more robust results than a single generalist model—even if that generalist is technically more capable.

## What I'd do differently

**Shell script timeouts**: The Gemini CLI occasionally hangs on large PRs. I added a 60-second timeout, but some legitimate reviews take longer. I need adaptive timeouts based on PR size.

**Structured output**: Currently agents return freeform markdown. If I parse this into structured data (JSON), the comparison agent could do more sophisticated analysis—deduplication, severity scoring, impact estimation.

**Context caching**: Each agent re-fetches PR data independently. For large PRs with extensive file changes, this adds 10-15 seconds. Claude's [prompt caching](https://docs.anthropic.com/claude/docs/prompt-caching) could eliminate this overhead.

## Requirements and setup

You need:
- GitHub CLI (`gh`) authenticated to your account
- Claude access (via Claude Code CLI)
- Gemini CLI (optional—system degrades gracefully to Claude-only reviews)

Skills are defined in markdown files following the [Claude Skills documentation](https://docs.claude.com/en/docs/agents-and-tools/agent-skills) structure. The orchestrator validates dependencies on first run and provides helpful error messages if something's missing.

## What's next

I'm tracking several extensions:

1. **GPT-4 as a third reviewer**: Do three independent reviews converge more reliably?
2. **Historical accuracy**: Track which model's severity assessments match actual production incidents
3. **Team-specific customization**: Different teams care about different issues—security teams want OWASP focus, platform teams want scalability analysis
4. **Automatic PR comments**: Webhook integration to post comparison reports directly to PRs

But the current version already saves me 20+ minutes per day across ~8 reviews. That's 2.5 hours per week—enough to justify the 4-hour build investment after two weeks.

## The coordination matters more than the models

We're past the point where frontier model capability is the bottleneck. Claude 3.5 Sonnet and Gemini 1.5 Pro are both excellent reviewers individually. But a coordinated system of specialized agents, each bringing unique strengths and operating independently, produces better results than any single model.

This isn't about replacing human reviewers. It's about giving them better information faster. When both AIs agree on a critical issue—SQL injection, missing error handling—that's a high-confidence signal worth immediate attention. When they disagree on architectural style, that's a signal for human judgment.

The system I built runs two AI perspectives in parallel, synthesizes their findings, surfaces consensus issues with high confidence, and explicitly flags disagreements for human review.

That's the coordination model I want: agents doing what they do best, orchestrated thoughtfully, with humans making final decisions on ambiguous cases.

And it starts with a markdown file.

---

*See [Claude Skills documentation](https://docs.claude.com/en/docs/agents-and-tools/agent-skills) and [awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) for implementation patterns. You can start with Claude-only reviews and add additional models later—the system degrades gracefully.*
