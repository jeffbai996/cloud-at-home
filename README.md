# cloud-at-home

![Version](https://img.shields.io/badge/version-0.2.0-208cff?style=flat-square)
![Stage](https://img.shields.io/badge/stage-alpha-334155?style=flat-square)
![Self-hosted](https://img.shields.io/badge/deployment-self--hosted-0f766e?style=flat-square)
![TypeScript](https://img.shields.io/badge/frontend-TypeScript-3178c6?style=flat-square)
![Python](https://img.shields.io/badge/gateway-Python-3776ab?style=flat-square)
![Public-source safety](https://img.shields.io/badge/public--source%20safety-enforced-16a34a?style=flat-square)

![cloud-at-home video application running on a home server deployment](docs/images/cloud-at-home-hero.jpeg)

*This image shows cloud-at-home’s video application, running on the developer’s home server deployment.*

Private-first, self-hosted cloud applications backed by established services:

- **Cloud Media** — movies and television through Jellyfin
- **Cloud Drive** — Finder-style FileBrowser client with Monaco editing, previews, transfers, user controls, and recoverable trash
- **Service switcher** — navigation between media, files, local AI, and optional runtime-configured services
- **Gateway** — encrypted upstream sessions, scoped proxy policies, preferences, playback tickets, and trash metadata

## Preview

The screenshots are generic v0.2 product mockups; no private deployment data is included.

### Cloud Media

![Cloud Media streaming interface demo](docs/images/cloud-media-demo.png)

### Cloud Drive

![Cloud Files file-management interface demo](docs/images/cloud-files-demo.png)

The stock services remain the data, authentication, and permission authorities.
Runtime credentials, databases, hostnames, media, and machine-specific service
routing stay outside Git. The repository ships generic configuration templates
so a deployment can be reproduced without publishing its private state.

## Development

```bash
npm install
python3 -m venv gateway/venv
gateway/venv/bin/pip install -r gateway/requirements-dev.txt
npm test
gateway/venv/bin/python -m pytest gateway/tests
```

Run the gateway with the environment described in `deploy/.env.example`, then:

```bash
npm run dev:media
npm run dev:files
```

## Staging deployment

`deploy/compose.yaml` intentionally leaves the stock FileBrowser service on
`:8080`. Cloud Media runs on `:8090` and Cloud Drive on `:8082` by default.

```bash
gateway/venv/bin/python deploy/init_runtime.py
docker compose -f deploy/compose.yaml up -d --build
```

Rollback is `deploy/rollback.sh`; it stops only Cloud Drive staging.

## Publishing model

The public repository contains only generic source, fixtures, and examples.
Deployment-specific branding, routes, credentials, media, and host configuration
belong in ignored runtime state or a separate private deployment checkout.

## v0.2

- richer Cloud Media playback controls, diagnostics, subtitles, resume handling,
  series navigation, ratings, My List, and cinema mode
- polished Cloud Drive identity, Finder-style browsing, drag-and-drop, downloads,
  Monaco-based editing, broader previews, user administration, logout, and trash
- stronger session recovery, preference normalization, playback reporting, and
  FileBrowser 2.63-compatible resource mutations
- substantially expanded unit, gateway, and desktop/iPad regression coverage

## Public-source safety

The repository uses neutral product names and must not inherit deployment-only
branding, hostnames, URLs, credentials, or personal data. Run
`npm run check:public` before committing; the same check runs in CI and as part
of `npm test`.
