# Self-hosted GitHub Actions LINUX runner for SethMed7/rotli.
# Deployed on Railway (Seth's personal "My Projects" workspace). Runs ONLY the
# OS-agnostic lanes of the Regression suite (bun/node/vite/playwright). It never
# compiles Rust (that stays on the macOS runner) and never holds a signing key.
#
# The runner self-registers on boot via a fine-grained PAT (env GH_RUNNER_TOKEN)
# and runs one ephemeral job, then the container re-registers fresh. See
# entrypoint.sh and docs/development/ci-runner.md.

FROM ghcr.io/actions/actions-runner:2.328.0

# actions-runner base ships as the unprivileged `runner` user. Install system
# packages as root, then drop back.
USER root

# Pin the runner version to match the base image tag above; keep them in step
# when bumping. Playwright's chromium apt deps are installed at runtime by
# `playwright install --with-deps chromium` in the e2e job, but we pre-seed the
# common libs so the first run isn't slow / doesn't need extra sudo surface.
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       curl \
       unzip \
       git \
       jq \
       # Playwright/chromium runtime libs (superset installed by --with-deps;
       # pre-seeding trims first-run time). Kept lean — no full desktop stack.
       libnss3 \
       libnspr4 \
       libatk1.0-0 \
       libatk-bridge2.0-0 \
       libcups2 \
       libdrm2 \
       libxkbcommon0 \
       libxcomposite1 \
       libxdamage1 \
       libxfixes3 \
       libxrandr2 \
       libgbm1 \
       libpango-1.0-0 \
       libcairo2 \
       libasound2 \
  && rm -rf /var/lib/apt/lists/*

# Node LTS — bun handles the app, but setup-bun and some tooling expect a node
# on PATH. Keep it minimal (nodesource LTS).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

# bun — pinned to the version the workflow's setup-bun also pins (1.3.3), so the
# runtime is identical whether a job uses the preinstalled bun or setup-bun.
ENV BUN_INSTALL=/usr/local/bun
ENV PATH="/usr/local/bun/bin:${PATH}"
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.3.3" \
  && bun --version

# NOTE: no rustup / cargo on purpose — Linux never compiles the Tauri crate.
# NOTE: no Apple signing/notary material EVER lives on this image.

# Our entrypoint registers the runner on boot and dereigsters on shutdown.
COPY --chown=runner:runner entrypoint.sh /home/runner/entrypoint.sh
RUN chmod +x /home/runner/entrypoint.sh

USER runner
WORKDIR /home/runner

ENTRYPOINT ["/home/runner/entrypoint.sh"]
