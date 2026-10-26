# Cloud at Home

Self-hosted web suite for video streaming, cloud drive, and photos.

![Cloud at Home preview](docs/images/cloud-at-home-hero-v2.jpeg)

## Preview

### Cloud Files

![Cloud Files demo](docs/images/cloud-files-demo.png)

### Cloud Media

![Cloud Media demo](docs/images/cloud-media-demo.png)

## Apps

- **Portal** — landing page, quick search, storage and library summary, admin dashboard
- **Cloud Files** — Google Drive-style file browser with folders, previews, uploads, trash, sharing, and storage tracking
- **Cloud Media** — personal cinema for movies and series with progress tracking, subtitles, profiles, and recommendations
- **Cloud Photos** — date-grouped photo and video library with favorites, albums, sharing, and slideshow view

## Architecture

```
Browser (React 19 + Vite + Tailwind v4)
  ├── /              Portal (app launcher, storage overview, global search)
  ├── /files         Cloud Files (folders, upload, preview, trash, star, share)
  ├── /media         Cloud Media (catalog, detail, HLS/direct player, subtitles)
  └── /photos        Cloud Photos (timeline, albums, favorites, lightbox)
         │
         ▼
Express 5 API
  ├── /api/auth/*    Google OAuth + JWT sessions + invite-based access control
  ├── /api/files/*   Drive CRUD, chunked uploads, streaming, range requests
  ├── /api/media/*   Library scan, FFprobe metadata, HLS transcode, OpenSubtitles
  ├── /api/photos/*  Timeline, albums, EXIF extraction, thumbnail generation
  └── /api/admin/*   Users, invites, storage quotas, media library paths
         │
         ▼
SQLite (WAL mode) + Local Filesystem + FFmpeg / Sharp workers
```

---

> **Note:** Public showcase repository. Source code is maintained privately.
>
> © 2026 Jeff Bai. All rights reserved.
