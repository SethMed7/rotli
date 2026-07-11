---
target: complete Breve suite inside Rotli
total_score: 23
p0_count: 0
p1_count: 5
timestamp: 2026-07-10T22-05-24Z
slug: src-components-breve
---
## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 2 | Configure errors are unreachable; model detection conflates loading and failure. |
| 2 | Match system / real world | 3 | Several scheduler and delivery terms assume technical knowledge. |
| 3 | User control and freedom | 2 | Dirty drafts and high-impact actions lack a safe exit or confirmation path. |
| 4 | Consistency and standards | 3 | Breve is internally coherent, but surrounding chrome remains note-centric. |
| 5 | Error prevention | 1 | Draft loss, immediate destructive actions, and aggregate validation are material gaps. |
| 6 | Recognition rather than recall | 3 | Stable navigation and field labels work; first-run sequencing is weak. |
| 7 | Flexibility and efficiency | 2 | Keyboard traversal exists, but resizing and dense fallback controls are weak. |
| 8 | Aesthetic and minimalist design | 3 | Calm and restrained; redundant chrome and microcopy under 11px add friction. |
| 9 | Error recovery | 2 | Watchlist messages are specific, but delivery recovery can be blocked. |
| 10 | Help and documentation | 2 | Inline guidance is good, but technical terms and disabled tests need explanation. |
| **Total** | | **23/40** | **Acceptable; hardening required** |

## Technical Audit Health

| Dimension | Score | Key finding |
|---|---:|---|
| Accessibility | 2 | Unnamed controls, weak focus contrast, and pointer-only resizing. |
| Performance | 3 | Lean implementation; textarea autosizing forces layout per edit. |
| Responsive design | 2 | Connection rows and toolbars can overflow narrow windows. |
| Theming | 3 | Semantic tokens are strong; Breve is omitted from glass reading-surface protection. |
| Anti-patterns | 4 | No generated-dashboard tells or decorative excess. |
| **Total** | **14/20** | **Good foundation with major gaps** |

## Anti-Patterns Verdict

Pass. Breve avoids card grids, oversized radii, gradients, decorative glass, heavy shadows, and gratuitous motion. It reads as a restrained operational lens over Rotli. The deterministic detector returned zero findings. The risk is incomplete integration and hardening, not visual slop.

## Overall Impression

The quiet bands, dense rows, semantic color, and stable five-part navigation are the correct foundation. The largest opportunity is to make the suite behave as confidently as it looks: protect drafts, make high-impact actions deliberate, expose accurate async states, and let the shell fully acknowledge that Breve is active.

## What's Working

- Five stable destinations, useful counts, and preserved underlying note panes form a coherent integrated lens.
- Semantic tokens, one radius family, restrained dividers, global reduced-motion support, and compact product typography fit Rotli.
- Source, scheduler, Keychain, save, validation, and delivery copy establish operational trust.

## Priority Issues

1. **[P1] Configure failures are trapped behind loading.** The null-draft loading branch runs before the query error branch, making retry unreachable. Reorder settled error/loading states and provide a clear recovery action.
2. **[P1] Dirty drafts can be discarded by navigation or refetch.** Track dirty state across Breve, guard destination/mode changes, and do not replace a dirty draft during background updates.
3. **[P1] High-impact actions lack safeguards.** Add inline confirmation for legacy retirement and credential removal; make consequences and cancellation explicit.
4. **[P1] Accessibility semantics and focus are incomplete.** Name routine switches and fallback selects, associate preferences with its label, restore a solid contrast-safe focus ring, and make the sidebar separator keyboard operable.
5. **[P1] Glass themes omit Breve's reading-surface protection.** Include Breve in the existing glass panel system so wallpaper cannot reduce text contrast.
6. **[P2] Breve's shell remains note-centric.** Replace irrelevant disabled sidebar chrome, clarify global search scope, disable hidden note history, and keep a persistent route back to Notes.
7. **[P2] Dense forms and narrow widths need refinement.** Increase microcopy and hit areas, add field-associated invalid states, wrap toolbars, and collapse connection rows safely.

## Persona Red Flags

- **Power user:** repeated explicit saves can be lost on navigation; fallback ordering and irrelevant disabled chrome slow routine work.
- **First-timer:** empty Briefs provides no next step; launchd, lead time, local helper, signal-cli, and owner UUID need plain-language context.
- **Accessibility-dependent user:** unnamed controls, low-contrast focus styles, 28px targets, and pointer-only resizing create avoidable barriers.

## Minor Observations

- Model connection loading and failure currently look like genuine unavailability.
- Recent brief dates are raw ISO strings.
- The repeated coffee glyph adds little once the sidebar establishes identity.
- Long watchlists need optional chunking while keeping full guidance readable.
- The content loader should resemble the page structure instead of a centered placeholder.

## Questions to Consider

- Can every disabled action explain the step that enables it?
- Does every destructive action state what remains recoverable?
- When Breve is active, does every visible piece of chrome still belong to the current task?
