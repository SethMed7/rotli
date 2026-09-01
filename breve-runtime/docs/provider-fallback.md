# Brief generation — current provider posture

Breve brief generation is intentionally local-only. The scheduled scripts may
retain provider-shaped compatibility labels, but every active generation path
runs `local-brief.ts`; unavailable cloud labels exit without starting a provider
process.

This is an account-safety boundary, not an availability fallback. Rotli does not
reuse a third-party subscription login for Breve, does not silently swap to a
cloud model, and does not weaken secure-note access rules to make a brief land.
If the local model is unavailable, the brief fails visibly and can be retried.

Downstream rendering and delivery remain deterministic local/runtime steps and
do not grant a model broader vault access.
