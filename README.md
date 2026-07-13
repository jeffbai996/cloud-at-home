# cloud-at-home

![Version](https://img.shields.io/badge/version-0.2.0-208cff?style=flat-square)
![Stage](https://img.shields.io/badge/stage-alpha-334155?style=flat-square)
![Self-hosted](https://img.shields.io/badge/deployment-self--hosted-0f766e?style=flat-square)
![TypeScript](https://img.shields.io/badge/frontend-TypeScript-3178c6?style=flat-square)
![Python](https://img.shields.io/badge/gateway-Python-3776ab?style=flat-square)

![cloud-at-home video application](docs/images/cloud-at-home-hero-v2.jpeg)

<sub><em>The Video interface running against a self-hosted media library.</em></sub>

Self-hosted web applications backed by established services:

- **Video** — a custom Jellyfin client with profiles, resume history, subtitles, favorites, lists, search, and responsive playback
- **Cloud Drive** — a Finder-style FileBrowser client with editing, previews, transfers, user controls, and recoverable trash
- **Service switcher** — navigation between video, files, local AI, and optional services
- **Gateway** — encrypted upstream sessions, scoped proxy policies, preferences, playback tickets, and trash metadata

## Preview

### Video

![Video streaming interface](docs/images/cloud-media-demo.png)

<sub><em>Browse, search, and play a media library from a responsive interface.</em></sub>

### Cloud Drive

![Cloud Drive file-management interface](docs/images/cloud-files-demo.png)

<sub><em>Preview, edit, transfer, and recover files from a Finder-style interface.</em></sub>

### Home server deployment

![Video running on a home server](docs/images/cloud-at-home-hero.jpeg)

<sub><em>A live home-server deployment backed by Jellyfin.</em></sub>

## Architecture

The React applications authenticate through a Flask gateway. Jellyfin and
FileBrowser remain the authorities for users, permissions, media, and files.

```text
Browser -> Video / Cloud Drive -> Gateway -> Jellyfin / FileBrowser
                                -> SQLite
```

## Run locally

```bash
npm install
python3 -m venv gateway/venv
gateway/venv/bin/pip install -r gateway/requirements-dev.txt
npm test
gateway/venv/bin/python -m pytest gateway/tests
npm run dev:media
npm run dev:files
```

## Deployment

Copy `deploy/.env.example` to the ignored runtime configuration, initialize the
runtime directory, and start the stack:

```bash
gateway/venv/bin/python deploy/init_runtime.py
docker compose -f deploy/compose.yaml up -d --build
```
