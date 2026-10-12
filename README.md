<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/full-logo-transparent.png">
    <img src=".github/assets/full-logo-transparent.png" alt="JellyGlance" width="280">
  </picture>
</p>

> [!WARNING]
> AFTER VERSION V1.3.2 the Project is being moved to https://github.com/JellyGlance/Server 

<p align="center">
  <strong>Your Jellyfin command center: live sessions, requests, users, libraries, stats, calendars, downloads, health, webhooks, and tasks in one clean dashboard.</strong>
</p>

<p align="center">
  Built by <strong>Nerdy-Technician</strong> for self-hosted media servers that deserve better visibility than a pile of browser tabs.
</p>

<p align="center">
  <a href="https://github.com/JellyGlance/Server/releases/latest">
    <img
      alt="Latest Release"
      src="https://img.shields.io/github/v/release/JellyGlance/Server?sort=semver&display_name=tag&style=for-the-badge&logo=github&logoColor=white&label=Latest%20Release&color=aa5cc3&labelColor=16111f">
  </a>

  <a href="https://github.com/JellyGlance/Server/releases">
    <img
      alt="Latest Beta"
      src="https://img.shields.io/github/v/tag/JellyGlance/Server?include_prereleases&filter=*beta*&sort=semver&style=for-the-badge&logo=github&logoColor=white&label=Latest%20Beta&color=7c5cff&labelColor=16111f">
  </a>

  <a href="https://github.com/JellyGlance/Server/stargazers">
    <img
      alt="GitHub Stars"
      src="https://img.shields.io/github/stars/JellyGlance/Server?style=for-the-badge&logo=github&logoColor=white&label=Stars&color=aa5cc3&labelColor=16111f">
  </a>

  <a href="https://github.com/JellyGlance/Server/actions/workflows/check-docker.yml">
    <img
      alt="Docker"
      src="https://img.shields.io/github/actions/workflow/status/JellyGlance/Server/check-docker.yml?style=for-the-badge&logo=docker&logoColor=white&label=Docker&color=2496ED&labelColor=16111f">
  </a>

  <a href="https://github.com/JellyGlance/Server/actions/workflows/check.yml">
    <img
      alt="CI"
      src="https://img.shields.io/github/actions/workflow/status/JellyGlance/Server/check.yml?style=for-the-badge&logo=githubactions&logoColor=white&label=CI&color=3FB950&labelColor=16111f">
  </a>

  <a href="https://github.com/JellyGlance/Server/blob/main/LICENSE">
    <img
      alt="License"
      src="https://img.shields.io/github/license/JellyGlance/Server?style=for-the-badge&logo=gnu&logoColor=white&label=License&color=aa5cc3&labelColor=16111f">
  </a>

  <a href="https://github.com/JellyGlance/Server/pkgs/container/server">
    <img
      alt="GHCR"
      src="https://img.shields.io/badge/Container-ghcr.io-2f3136?style=for-the-badge&logo=github&logoColor=white&labelColor=16111f">
  </a>
</p>


<p align="center">
  <a href="https://jellyglance.com/"><strong>Website</strong></a>
  ·
  <a href="https://demo.jellyglance.com/"><strong>Live Demo</strong></a>
  ·
  <a href="https://github.com/JellyGlance/Documentation"><strong>Documentation</strong></a>
  ·
  <a href="https://discord.gg/dMGhv8j2kx"><strong>Discord</strong></a>
  ·
  <a href="#quick-docker-start"><strong>Docker Start</strong></a>
  ·
  <a href="#integrations"><strong>Integrations</strong></a>
</p>

## Live Demo

Try JellyGlance without installing anything at **[demo.jellyglance.com](https://demo.jellyglance.com/)**. It's read-only, filled with real film and TV data from TMDB and simulated viewers, downloads and requests, and resets every few hours. The demo's source is in **[JellyGlance/Demo](https://github.com/JellyGlance/Demo)**.

## Documentation

Read the guides and contribute in **[JellyGlance/Documentation](https://github.com/JellyGlance/Documentation)**.

- [Installation and first setup](https://github.com/JellyGlance/Documentation/blob/main/docs/guide/getting-started.md)
- [Integration directory](https://github.com/JellyGlance/Documentation/blob/main/docs/integrations.md)
- [Reverse proxy: Nginx, Caddy, Nginx Proxy Manager, and Traefik](https://github.com/JellyGlance/Documentation/blob/main/docs/operations/reverse-proxy.md)
- [Configuration reference](https://github.com/JellyGlance/Documentation/blob/main/docs/reference/configuration.md)
- [Backup and restore](https://github.com/JellyGlance/Documentation/blob/main/docs/operations/backup-restore.md)
- [Troubleshooting](https://github.com/JellyGlance/Documentation/blob/main/docs/guide/troubleshooting.md)

For documentation corrections or requests, [open a docs issue](https://github.com/JellyGlance/Documentation/issues/new/choose). Application bugs belong in [this project's issue tracker](https://github.com/JellyGlance/Server/issues). Visit [jellyglance.com](https://jellyglance.com/) for the project website. Its source is in **[JellyGlance/Website](https://github.com/JellyGlance/Website)**. See [CONTRIBUTING.md](CONTRIBUTING.md) before changing widgets.

## Why JellyGlance

JellyGlance gives your Jellyfin server a proper dashboard: live sessions, request triage, user watch stats, recent media, library health, activity history, release calendars, download queues, webhooks, backups, and integrations in one polished place.

It is built around three jobs:

- **Watch** live streams, playback history, watch-time trends, user activity, favourites, watchlists, and recently added media.
- **Triage** requests, Jellyfin availability, failed integrations, webhook delivery, backups, and user access.
- **Operate** calendars, download queues, scheduled syncs, health checks, quick actions, audit history, and notifications.

## Highlights

- **Live active sessions** with device, client, codec, bitrate, user, runtime, episode details, and platform icons.
- **Customizable home command center** with drag-and-drop section order, visibility toggles, presets, density, themes, kiosk mode, and alert rules.
- **Requests page** for Jellyseerr and Overseerr with combined search, posters, ratings, cast lists, season controls, route editing, availability checks, request actions, and direct open links.
- **Wizarr invite management** with custom invite codes, server and library targeting, optional wizard bundle IDs, copy/open/delete actions, invite sync, and invite webhook notifications.
- **3rd party app support** for Tdarr transcodes, Maintainerr cleanup, SickChill, Arr apps, Seerr apps, download clients, and webhooks.
- **Recently added shelves** grouped by library with poster-first rows for fast scanning.
- **User dashboards** for Jellyfin Quick Connect users, local JellyGlance users, OIDC-ready accounts, favourites, watchlists, Continue Watching, and recently watched media.
- **Useful statistics** covering top movies, series, libraries, clients, users, trends, watch time, and activity heatmaps.
- **Calendar and downloads** for release planning, torrent URLs, magnet links, torrent uploads, and active queues.
- **Webhook notifications** with delivery history for session, media, request, task, backup, download, and health events.
- **Admin audit trail** for settings, auth, integrations, webhooks, roles, backups, and restore-sensitive actions.
- **Backup and restore friendly** Docker paths via `/app/config` and `/app/backups`.

## Integrations

<table>
  <tr>
    <td align="center" width="20%">
      <img src=".github/assets/icons/selfhst/jellyfin.svg" alt="Jellyfin" width="42"><br>
      <strong>Jellyfin</strong>
    </td>
    <td align="center" width="20%">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/wizarr.png" alt="Wizarr" width="42"><br>
      <strong>Wizarr</strong>
    </td>
    <td align="center" width="20%">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/tdarr.png" alt="Tdarr" width="42"><br>
      <strong>Tdarr</strong>
    </td>
    <td align="center" width="20%">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/maintainerr.png" alt="Maintainerr" width="42"><br>
      <strong>Maintainerr</strong>
    </td>
    <td align="center" width="20%">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/sickchill.png" alt="SickChill" width="42"><br>
      <strong>SickChill</strong>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src=".github/assets/icons/selfhst/sonarr.svg" alt="Sonarr" width="42"><br>
      <strong>Sonarr</strong>
    </td>
    <td align="center">
      <img src=".github/assets/icons/selfhst/radarr.svg" alt="Radarr" width="42"><br>
      <strong>Radarr</strong>
    </td>
    <td align="center">
      <img src=".github/assets/icons/selfhst/lidarr.svg" alt="Lidarr" width="42"><br>
      <strong>Lidarr</strong>
    </td>
    <td align="center">
      <img src=".github/assets/icons/selfhst/bazarr.svg" alt="Bazarr" width="42"><br>
      <strong>Bazarr</strong>
    </td>
    <td align="center">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/prowlarr.png" alt="Prowlarr" width="42"><br>
      <strong>Prowlarr</strong>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/jellyseerr.png" alt="Jellyseerr" width="42"><br>
      <strong>Jellyseerr</strong>
    </td>
    <td align="center">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/overseerr.png" alt="Overseerr" width="42"><br>
      <strong>Overseerr</strong>
    </td>
    <td align="center">
      <img src=".github/assets/icons/selfhst/qbittorrent.svg" alt="qBittorrent" width="42"><br>
      <strong>qBittorrent</strong>
    </td>
    <td align="center">
      <img src=".github/assets/icons/selfhst/transmission.svg" alt="Transmission" width="42"><br>
      <strong>Transmission</strong>
    </td>
    <td align="center">
      <img src=".github/assets/icons/selfhst/deluge.svg" alt="Deluge" width="42"><br>
      <strong>Deluge</strong>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src=".github/assets/icons/selfhst/sabnzbd.svg" alt="SABnzbd" width="42"><br>
      <strong>SABnzbd</strong>
    </td>
    <td align="center">
      <img src=".github/assets/icons/selfhst/nzbget.svg" alt="NZBGet" width="42"><br>
      <strong>NZBGet</strong>
    </td>
    <td align="center">
      <img src=".github/assets/icons/selfhst/discord.svg" alt="Discord" width="42"><br>
      <strong>Discord</strong>
    </td>
    <td align="center">
      <img src=".github/assets/icons/selfhst/gotify.svg" alt="Gotify" width="42"><br>
      <strong>Gotify</strong>
    </td>
  </tr>
</table>

## Quick Docker Start

Create a `docker-compose.yml`:

```yaml
services:
  jellyglance-db:
    image: postgres:16-alpine
    container_name: jellyglance-db
    restart: unless-stopped
    shm_size: "1gb"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: change-me
      POSTGRES_DB: jellyglance
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready --dbname=jellyglance --username=postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  jellyglance:
    image: ghcr.io/jellyglance/server:latest
    container_name: jellyglance
    restart: unless-stopped
    depends_on:
      jellyglance-db:
        condition: service_healthy
    ports:
      - "3000:3000"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: change-me
      POSTGRES_IP: jellyglance-db
      POSTGRES_PORT: 5432
      POSTGRES_DB: jellyglance
      JWT_SECRET: replace-me-with-a-long-random-secret
      TZ: Europe/London
      CONFIG_DIR: /app/config
      BACKUP_DIR: /app/backups
    volumes:
      - ./config:/app/config
      - ./backups:/app/backups

volumes:
  postgres-data:
```

Start it:

```sh
docker compose up -d
```

Use Docker Compose v2 (`docker compose`, with a space). The old Python `docker-compose` v1 log watcher can crash on modern Docker events with `KeyError: 'id'`.

Open:

```text
http://localhost:3000
```

## First Run

1. Open JellyGlance.
2. Add your Jellyfin server URL.
3. Add a Jellyfin API key so JellyGlance can sync users, libraries, artwork, sessions, and activity.
4. Choose your admin access mode.
5. Let the first sync run.

After setup, JellyGlance can use artwork from your Jellyfin library for login backgrounds and media views.

## Persistent Folders

The Docker image is designed around simple, visible paths:

| Host path | Container path | What it is for |
| --- | --- | --- |
| `./config` | `/app/config` | Runtime config and local app files |
| `./backups` | `/app/backups` | Backup exports and restore uploads |
| `postgres-data` | PostgreSQL data volume | Database storage |

Backups created inside JellyGlance appear in `./backups`. To restore, place a backup JSON file in that folder or upload it from the Backup page.

## Updates

```sh
docker compose pull
docker compose up -d
```

## Community
This Project will always be free: no ads, no ssotax, no buyouts, no subscription plan, Free Forever.



<p align="center">
  <a title="JellyGlance Discord" href="https://discord.gg/dMGhv8j2kx"><strong>JellyGlance Discord</strong></a>
</p>

## Credits

Created by **Nerdy-Technician**.

Inspired by **Jellystat**.
