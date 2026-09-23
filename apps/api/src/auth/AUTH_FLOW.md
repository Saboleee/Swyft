# Wallet Auth Flow

This document describes how Swyft authenticates a Stellar wallet and issues a
session JWT. The server is the source of truth for nonce issuance, signature
verification, and session authorization.

## Overview

1. Client requests a nonce for a wallet address.
2. Server issues a nonce, stores it with a short TTL, and returns it.
3. Client signs the nonce with the wallet key and submits the signature.
4. Server verifies the signature and **atomically consumes** the nonce.
5. Server issues a session JWT bound to the wallet address.

## Nonce lifecycle (single-use)

A nonce is valid for exactly one successful verification. The consume step is
atomic: the nonce is removed (or marked used) in the same operation that
validates it, so a nonce can never be verified twice.

Invariants:

- A nonce is bound to the wallet address that requested it.
- A nonce is single-use: consumed on the first successful signature check.
- A nonce expires after its TTL and is rejected once expired.
- Replay or concurrent reuse of a consumed nonce is rejected.
- Unknown nonces are rejected (deny-by-default).

### Atomic consume

The nonce store must expose a compare-and-delete (or equivalent atomic
consume) primitive. Verification MUST NOT be implemented as a read followed by
a separate delete, because two concurrent requests could both read the same
nonce before either deletes it.

```
consume(nonce, wallet) -> OK | UNKNOWN | EXPIRED | ALREADY_USED
```

Only `OK` permits signature verification to proceed. Any other result fails
the request.

## Fail-closed behavior

If the nonce store (Redis/DB) is unavailable, the server MUST reject the
verification request. It MUST NOT fall back to an in-memory cache, skip the
nonce check, or issue a session. Auth writes fail closed.

- Store timeout or connection error -> reject with `NONCE_STORE_UNAVAILABLE`.
- Partial/ambiguous store response -> reject (treat as unavailable).
- Never log the nonce value, signature, or any secret material.

## Authorization

- The server validates the wallet address format and verifies the signature
  server-side; client-supplied identity claims are never trusted.
- The issued JWT is bound to the verified wallet address.
- Privileged surfaces are deny-by-default: a request without a valid,
  unexpired session is rejected before any policy check.
- Untrusted clients cannot bypass the nonce policy by omitting, reusing, or
  forging nonce fields.

## Error codes

Verification returns stable, typed error codes so clients and ops can react
consistently. Responses include a correlation id for tracing.

| Code | Meaning |
| --- | --- |
| `NONCE_UNKNOWN` | Nonce was never issued or has been evicted. |
| `NONCE_EXPIRED` | Nonce TTL elapsed before verification. |
| `NONCE_ALREADY_USED` | Nonce was already consumed (replay/concurrent reuse). |
| `NONCE_STORE_UNAVAILABLE` | Nonce store unreachable; request failed closed. |
| `SIGNATURE_INVALID` | Signature did not verify against the wallet. |
| `WALLET_INVALID` | Wallet address failed server-side validation. |

## Observability

- Emit counters for each error code above (no secret values in labels).
- Emit a counter for successful verifications on the money path.
- Log correlation ids, never nonces, signatures, or tokens.

## Edge cases

- **Concurrent requests:** atomic consume guarantees only one succeeds; the
  loser receives `NONCE_ALREADY_USED`.
- **Replay:** a consumed nonce is rejected on every subsequent attempt.
- **Store outage:** verification fails closed with `NONCE_STORE_UNAVAILABLE`.
- **Expired session / wrong role:** rejected by the JWT guard before policy.
- **Adversarial input:** malformed addresses/signatures are rejected without
  touching the nonce store beyond the consume attempt.
- **Testnet vs mainnet:** nonce keys are namespaced per network to avoid
  cross-network address drift.

## Rollback / kill-switch

Any change to the nonce or verification path lands behind a feature flag.
Disabling the flag restores the previous behavior without a deploy. Rollback
steps are documented in the PR description.

## References

- `apps/api/src/auth/nonce-single-use.spec.ts`
