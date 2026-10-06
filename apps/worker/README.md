# Background worker boundary

Reserved for validated catalog imports, media processing and payment reconciliation.
No worker is started in the foundation milestone. Queue schemas, retry policy, idempotency
and Redis credentials must be implemented together with the first actual job (stage 3).
