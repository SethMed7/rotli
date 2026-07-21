# Architecture decision records

This directory records cross-boundary decisions that are expensive to reverse
or easy to re-litigate without their original constraints. ADRs explain why;
current contracts define what; code and tests prove how.

## When to write an ADR

Write one before adopting or replacing:

- a durable data format, contract version, or migration policy;
- a trust boundary, credential store, network destination class, or security
  assumption;
- a major editor, codec, runtime, persistence, or delivery dependency;
- a release channel, signing model, or updater protocol;
- a cross-process or cross-repository protocol; or
- an exception to the dependency direction or a product law.

Do not create ADRs for ordinary implementation choices, small refactors, bug
fixes with an obvious invariant, or decisions already fully explained by an
owning capability contract. A large ADR catalog is not architectural maturity;
current, enforceable decisions are.

## Lifecycle and naming

Files use `NNNN-kebab-case-title.md`, allocated monotonically. Status is one of:

- `proposed` — under active review, not a rule;
- `accepted` — current decision;
- `superseded` — retained for history and linked to its replacement; or
- `rejected` — considered and deliberately not adopted.

Never rewrite an accepted ADR to make history look cleaner. Add a dated note or
superseding ADR. Move exploratory proposals with no durable decision to
`docs/archive/` rather than leaving them apparently current.

## Template

```markdown
# NNNN — Decision title

- Status: proposed
- Date: YYYY-MM-DD
- Owners: names or roles
- Supersedes: none
- Related contracts: links

## Context

What constraint, risk, or repeated decision requires a durable record?

## Decision

State the chosen boundary in testable terms.

## Alternatives considered

List credible alternatives and why they were not selected.

## Consequences

Record benefits, costs, residual risks, migration work, and rollback limits.

## Evidence

Link tests, measurements, audits, or prototypes that support the decision.

## Revisit triggers

Name the measurements or external changes that justify reopening it.
```

## Relationship to other documentation

- `ARCHITECTURE.md` and capability contracts own current normative rules.
- Dated architecture audits report observations and priorities, not permanent
  decisions.
- `CHANGELOG.md` records shipped behavior, not decision rationale.
- CARL may summarize an accepted decision in a compact recall record that links
  here. It never copies the full ADR.
- `AGENTS.md` carries only the small set of laws every task must load.

An accepted ADR that changes behavior is incomplete until its owning contract,
mechanical guards, tests, and CARL recall agree.
