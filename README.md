# cloud-at-home

Private-first, self-hosted cloud applications backed by established services:

- **Cloud Media** — movies and television through Jellyfin
- **Cloud Files** — Finder-style FileBrowser client with editors, previews, transfers, and recoverable trash
- **Service switcher** — navigation between media, files, local AI, and optional runtime-configured services
- **Gateway** — encrypted upstream sessions, scoped proxy policies, preferences, playback tickets, and trash metadata

The stock services remain the data, authentication, and permission authorities.
Runtime credentials, databases, hostnames, media, and machine-specific service
routing stay outside Git. The repository ships generic configuration templates
so a deployment can be reproduced without publishing its private state.

Open WebUI is deliberately not injected with Cloud Files CSS or JavaScript. The
files under `owui/` are retained as an archived experiment, not a deployment
source.

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
`:8080`. Cloud Media runs on `:8090` and Cloud Files on `:8082` by default.

```bash
gateway/venv/bin/python deploy/init_runtime.py
docker compose -f deploy/compose.yaml up -d --build
```

Rollback is `deploy/rollback.sh`; it stops only Cloud Files staging.

## Publishing model

The project is private while its interfaces and deployment model stabilize,
but source, fixtures, and examples are kept suitable for a future open-source
release. Use generic sample users and hosts, keep secrets in ignored runtime
configuration, and audit the complete Git history before changing repository
visibility.

## Public-source safety

The repository uses neutral product names and must not inherit deployment-only
branding, hostnames, URLs, credentials, or personal data. Run
`npm run check:public` before committing; the same check runs in CI and as part
of `npm test`.
