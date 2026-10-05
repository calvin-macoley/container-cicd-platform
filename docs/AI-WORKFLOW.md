# AI Development Workflow

This project is developed with [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) as a coding assistant. This document explains how the AI environment is configured, what the AI is and isn't allowed to do, and why.

The short version: **the AI writes application code under guardrails, I write all platform and DevOps code myself, and the AI reviews it.**

## Ownership model

The goal of this repository is to demonstrate container-based delivery skills, so responsibilities are split deliberately.

| Area | Author | AI role |
|---|---|---|
| Application code (`app/`) and its tests | Claude Code, under review | Writes, tests, self-reviews |
| Documentation (ADRs, runtime contract, release notes) | Shared | Drafts, I edit |
| Dockerfiles, compose files, Makefile | Me | Reviews only |
| CI/CD workflows (`.github/workflows/`) | Me | Reviews only |
| Terraform, Ansible, Traefik, monitoring | Me | Reviews only |

The interface between the two halves is [`docs/app-runtime.md`](app-runtime.md): the application documents the contract a container must satisfy (start command, migration command, port, environment variables, health endpoints, build-time values), and the platform is built against that contract. This mirrors how application and platform teams typically collaborate.

## Layers of control

Claude Code offers several mechanisms for steering an agent. They differ in when they apply and how strictly, so each is used for a different purpose.

```mermaid
flowchart TB
    A["CLAUDE.md + rules<br/>(always-loaded context)"] --> E[Claude Code session]
    B["Skills<br/>(loaded on demand)"] --> E
    C["Subagents<br/>(isolated specialists)"] --> E
    E --> D{"Permissions<br/>allow / ask / deny"}
    D --> F[Tool use: edit files, run commands]
    F --> G["Hooks<br/>(deterministic, every time)"]
    G --> H["Pull request + CI<br/>(final gate)"]
```

Instructions guide behavior; permissions and hooks enforce it. Anything that must never happen is enforced, not just requested.

## Directory layout

```
CLAUDE.md                        # Project context, loaded every session
app/CLAUDE.md                    # App conventions, loaded when working in app/
infra/terraform/CLAUDE.md        # Terraform rules, loaded when working in infra/
.claude/
├── settings.json                # Permissions and hooks (committed)
├── rules/
│   ├── security.md
│   └── devops-ownership.md
├── agents/
│   ├── code-reviewer.md
│   └── devops-reviewer.md
├── commands/
│   └── verify.md
└── skills/
    ├── add-endpoint/            # SKILL.md + test template
    ├── db-migration/
    ├── write-adr/               # SKILL.md + ADR template
    ├── release-notes/
    └── ansible-role/            # Manual-only review checklist
```

Personal overrides (`CLAUDE.local.md`, `.claude/settings.local.json`) are gitignored, so the committed configuration is the shared project baseline.

## Context: CLAUDE.md files and rules

The root `CLAUDE.md` is kept short because it is loaded into every session. It covers what the project is, the stack, core conventions (all config via environment variables, every endpoint tested, every schema change migrated, one image for every environment), and the ownership boundaries above.

Directory-scoped `CLAUDE.md` files load only when the agent works in that directory, so app conventions don't consume context during unrelated work and vice versa. `app/CLAUDE.md` covers code structure and metric labeling; `infra/terraform/CLAUDE.md` states that Terraform is plan-only.

Files in `.claude/rules/` hold rules that must survive regardless of how `CLAUDE.md` evolves: `security.md` (no hardcoded secrets, no reading `.env` or vault files, non-root containers) and `devops-ownership.md` (the AI does not create or modify platform files unless explicitly asked in the current message).

## Enforcement: permissions

`.claude/settings.json` defines three tiers.

**Allow** covers safe, frequent commands such as running tests and the package manager, so the agent isn't interrupted constantly.

**Ask** covers every DevOps path (`docker/`, `deploy/`, `infra/`, `ansible/`, `monitoring/`, `.github/workflows/`, `Makefile`) and Docker commands. The agent must request approval before touching these, so it can help when I explicitly want it to, but can never change platform files silently. This is the technical backstop for the ownership model.

**Deny** covers anything that affects real environments or secrets: reading `.env` and vault files, `terraform apply`/`destroy`, `ansible-playbook`, `docker push`, and `git push`. No AI action reaches a remote system; deployments only happen through reviewed CI pipelines.

## Automation: hooks

A `PostToolUse` hook runs `ruff format` and `ruff check --fix` on the app after every file edit. Unlike instructions, hooks run every time, so formatting is never left to the model's memory and diffs stay clean.

## Specialists: subagents

Subagents run in their own context window with a restricted tool set.

**`code-reviewer`** reviews the current diff for correctness, missing tests or migrations, misplaced configuration, secrets in code, and convention violations. It reports findings by severity and does not edit files. It is run at the end of every feature before commits are proposed.

**`devops-reviewer`** reviews the platform code I write: Dockerfiles, compose files, workflows, Terraform, and Ansible. It has only read tools (`Read`, `Grep`, `Glob`), so it physically cannot modify files. It is instructed to act as a mentor: for each finding it gives severity, location, the problem, why it matters, and a hint toward the fix rather than the full solution, so the learning stays with me.

## Playbooks: skills

Skills are loaded only when a task matches their description, or when invoked with `/skill-name`, which keeps detailed procedures out of the always-loaded context.

| Skill | Purpose | Invocation |
|---|---|---|
| `add-endpoint` | Consistent route, schema, service, test, and docs for every endpoint. Ships a test template. | Automatic |
| `db-migration` | Enforces expand/contract migrations (see below). | Automatic |
| `write-adr` | Architecture decision records from a bundled template, with honest alternatives. | Automatic |
| `release-notes` | Groups conventional commits into release notes; never creates tags itself. | Automatic |
| `ansible-role` | Review checklist for roles I write. | Manual only (`disable-model-invocation`) |

### Why `db-migration` matters

Canary releases run the old and new application versions **at the same time against the same database**. A migration that drops or renames a column breaks whichever version doesn't expect it. The skill therefore restricts each release to backward-compatible changes and splits destructive changes across releases using the expand/contract pattern, and it requires every migration to be proven reversible (upgrade, downgrade, upgrade) before review.

## Development loop

1. **Branch.** Every change starts on a feature branch; `main` is protected and only accepts pull requests.
2. **Plan.** Larger tasks start in plan mode: the agent proposes a plan and file list, and nothing is written until I approve it.
3. **Implement in small steps.** The agent runs linting, type checks, and tests after each step and fixes failures before continuing.
4. **Self-review.** The `code-reviewer` subagent reviews the diff; findings are summarized and addressed.
5. **Human review.** I review the diff and commit using conventional commits.
6. **CI as the final gate.** The pull request must pass the same checks in GitHub Actions, regardless of who or what wrote the code.

For platform work the loop is reversed: I write the code, run the `devops-reviewer` subagent, and decide which findings to act on.

## Design principles

- **Enforce, don't just instruct.** Anything that must not happen is blocked by permissions, not left to a prompt.
- **Least privilege.** Reviewers get read-only tools; no AI action can reach a remote environment.
- **Keep always-on context small.** Detailed procedures live in skills and scoped `CLAUDE.md` files.
- **Same gates for everyone.** AI-written code passes exactly the same CI as human-written code.
- **Transparency.** This document exists so anyone reading the repository knows how AI was used and where its boundaries were.
