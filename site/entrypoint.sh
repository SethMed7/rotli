#!/bin/sh
# The site container: Caddy serves everything, and a small Bun sidecar answers
# /api/subscribe on 127.0.0.1 behind it (site/server/subscribe.ts). Caddy is
# exec'd into this process, so it is PID 1 and receives Railway's stop signal.
# The sidecar fails soft: if it cannot start or crashes, the pages keep serving,
# the footer hides its form (the probe fails), and it is retried with backoff.
set -eu

(
	delay=2
	while :; do
		started=$(date +%s)
		bun /opt/subscribe/subscribe.ts || true
		# A run that lasted a while was healthy; start the backoff over.
		if [ $(($(date +%s) - started)) -gt 60 ]; then delay=2; fi
		echo "subscribe sidecar stopped; retrying in ${delay}s" >&2
		sleep "$delay"
		delay=$((delay < 60 ? delay * 2 : 60))
	done
) &

exec "$@"
