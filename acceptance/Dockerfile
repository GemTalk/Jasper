# Headless acceptance-test runner.
#
# Runs the Playwright + VS Code acceptance suite inside a Linux container under
# Xvfb (a virtual framebuffer), so the real VS Code window renders to an
# off-machine display and never appears on the developer's desktop. This is the
# same way the suite runs in CI.
#
# The base image ships Node, the Playwright browsers, their shared libraries,
# and Xvfb. We add the extra libraries VS Code's Electron needs beyond Chromium,
# plus the toolchain to build this repo's native node modules (koffi, keytar).
FROM mcr.microsoft.com/playwright:v1.61.1-noble

RUN apt-get update && apt-get install -y --no-install-recommends \
      libsecret-1-0 \
      libsecret-1-dev \
      libgbm1 \
      libgtk-3-0 \
      libnss3 \
      libasound2t64 \
      build-essential \
      python3 \
      unzip \
      curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first, keyed only on the manifests, so edits to source
# don't bust the (slow) npm ci layer. All workspace manifests are needed for the
# workspace-aware install.
COPY package.json package-lock.json .npmrc ./
COPY client/package.json ./client/
COPY server/package.json ./server/
COPY mcp-server/package.json ./mcp-server/
# The base image's bundled npm (11.13.0) is below the repo's devEngines floor
# (>=11.16.0), so npm ci itself would fail with EBADDEVENGINES.
RUN npm install -g npm@11.17.0 && npm ci

# Install GemStone/S 64 Bit for the in-container stone. This layer depends only
# on the provisioning scripts, so it caches across source edits (it downloads
# ~450 MB, so we very much want it cached).
COPY client/bin ./client/bin
RUN cd client && bash bin/gs-install.sh 3.7.5

# Fonts so VS Code's codicon glyphs render instead of tofu boxes. Its own layer,
# after the heavy GemStone download, so adding it doesn't bust that cache.
RUN apt-get update && apt-get install -y --no-install-recommends \
      fonts-liberation \
      fontconfig \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f

COPY . .

# The extension must be built for VS Code to load it from source.
RUN npm run compile:client

# The stone must run as a non-root user (guest NetLDI refuses root), so run the
# whole container — including VS Code — as pwuser. Then the git clones VS Code
# writes are owned by the same user as the gem that loads them (no cross-user
# EACCES). Pre-create the mount points so their fresh named volume / bind mounts
# inherit pwuser ownership.
RUN mkdir -p /app/.vscode-test /app/acceptance/test-results /app/acceptance/playwright-report \
 && chown -R pwuser:pwuser /app
USER pwuser

# `xvfb-run` gives the run a virtual X display; VS Code renders there.
CMD ["xvfb-run", "-a", "--server-args=-screen 0 1280x1024x24", "npm", "run", "test:acceptance"]
