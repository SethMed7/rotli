---
id: demo-proj-gw
created: 2026-06-28
updated: 2026-07-05
pinned: false
area: projects
summary: The Elavon → Lithic cutover — mapping, dual-write window, rollback plan.
tags: [gateway, payments]
---
# Gateway migration

Three things must land before Thursday: the settlement mapping, the dual-write
window, and a rollback that takes minutes, not a war room.

1. **Mapping** — every Elavon field to a Lithic equivalent (or a documented gap).
2. **Dual-write** — write both for a week; reconcile nightly.
3. **Rollback** — a single flag flips traffic back.
