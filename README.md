<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/full-logo-transparent.png">
    <img src=".github/assets/full-logo-transparent.png" alt="JellyGlance" width="280">
  </picture>
</p>

<p align="center">
  <strong>A self-hosted dashboard for Jellyfin and Emby: live sessions, watch history, statistics, requests, downloads and the apps around your media server, in one place.</strong>
</p>

<p align="center">
  <a href="https://github.com/JellyGlance/Server/releases/latest">
    <img
      alt="Latest Release"
      src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.github.com%2Frepos%2FJellyGlance%2FServer%2Freleases%2Flatest&query=%24.tag_name&cacheSeconds=3600&style=for-the-badge&logo=github&logoColor=white&label=Latest%20Release&color=aa5cc3&labelColor=16111f">
  </a>

  <a href="https://github.com/JellyGlance/Server/stargazers">
    <img
      alt="GitHub Stars"
      src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fapi.github.com%2Frepos%2FJellyGlance%2FServer&query=%24.stargazers_count&cacheSeconds=3600&style=for-the-badge&logo=github&logoColor=white&label=Stars&color=aa5cc3&labelColor=16111f">
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
      src="https://img.shields.io/github/license/JellyGlance/Server?style=for-the-badge&logo=opensourceinitiative&logoColor=white&label=License&color=aa5cc3&labelColor=16111f">
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
  <a href="https://demo.jellyglance.com/"><strong>Live demo</strong></a>
  ·
  <a href="https://docs.jellyglance.com/"><strong>Documentation</strong></a>
  ·
  <a href="https://discord.gg/dMGhv8j2kx"><strong>Discord</strong></a>
</p>

## Contents

- [What it is](#what-it-is)
- [Screenshots](#screenshots)
- [Features](#features)
- [Integrations](#integrations)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Updating](#updating)
- [Documentation](#documentation)
- [Community and support](#community-and-support)
- [Contributing](#contributing)
- [License and credits](#license-and-credits)

## What it is

JellyGlance connects to your Jellyfin or Emby server and keeps its own PostgreSQL history of what's played, by whom and on what. On top of that it gives you a home dashboard, statistics and recaps, and links to the request, download and \*arr apps you already run, so you can see and manage your server without a pile of browser tabs.

It runs as a single Docker container next to PostgreSQL. It's free, with no ads, subscriptions or paid tiers. Try the read-only **[live demo](https://demo.jellyglance.com/)** first if you like (its source is in [JellyGlance/Demo](https://github.com/JellyGlance/Demo)).

## Screenshots

| Home | Activity |
| --- | --- |
| ![Home dashboard](.github/assets/screenshots/home.png) | ![Activity history](.github/assets/screenshots/activity.png) |
| **Statistics** | **Requests** |
| ![Statistics](.github/assets/screenshots/statistics.png) | ![Requests](.github/assets/screenshots/requests.png) |
| **Libraries** | **Recently added** |
| ![Libraries](.github/assets/screenshots/libraries-grid.png) | ![Recently added](.github/assets/screenshots/recently-added.png) |

## Features

- **Jellyfin and Emby.** Pick the server type during setup or let JellyGlance detect it. Emby installs can import history from the Playback Reporting plugin, and Jellystat or Tautulli history can be imported too.
- **Live sessions.** User, device, client, codec, bitrate and progress for everything playing now.
- **A home dashboard you arrange.** Drag-and-drop sections, visibility toggles, presets, density, themes, kiosk mode and alert rules.
- **Statistics and recaps.** Top movies, series, libraries, clients and users, watch-time trends, activity heatmaps, and weekly, monthly and yearly recaps with shareable cards.
- **Activity history and libraries.** Full playback history, library views and recently added shelves grouped by library.
- **Requests.** Search and manage Jellyseerr and Overseerr requests, with availability checks.
- **Calendar and downloads.** Upcoming releases from the \*arr apps and the queues from your download clients.
- **Users.** Dashboards with favourites, watchlists, Continue Watching and recently watched, and Wizarr invite management.
- **Notifications.** Webhooks, Discord and Gotify, with delivery history, plus email newsletters.
- **Sign-in options.** Local JellyGlance accounts, Jellyfin Quick Connect and OIDC single sign-on (Authentik, Authelia, Keycloak; see [docs/oidc.md](docs/oidc.md)), with group-to-role mapping, roles and an admin audit trail.
- **Backups.** Export and restore from the Backup page, stored in a plain folder you can see.
- **Translations.** English (US and UK), Català, Čeština, Deutsch, Español, Français, Italiano, Polski and 中文.

## Integrations

Connect these under **Settings > Integrations**. See the [integration directory](https://docs.jellyglance.com/integrations/) for setup details.

<table>
  <tr>
    <td align="center" width="25%">
      <img src=".github/assets/icons/selfhst/jellyfin.svg" alt="Jellyfin" width="42"><br>
      <strong>Jellyfin</strong>
    </td>
    <td align="center" width="25%">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/emby.png" alt="Emby" width="42"><br>
      <strong>Emby</strong>
    </td>
    <td align="center" width="25%">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/jellyseerr.png" alt="Jellyseerr" width="42"><br>
      <strong>Jellyseerr</strong>
    </td>
    <td align="center" width="25%">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/overseerr.png" alt="Overseerr" width="42"><br>
      <strong>Overseerr</strong>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src=".github/assets/icons/selfhst/sonarr.svg" alt="Sonarr" width="42"><br>
      <strong>Sonarr</strong>
    </td>
    <td align="center">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/sickchill.png" alt="SickChill" width="42"><br>
      <strong>SickChill</strong>
    </td>
    <td align="center">
      <img src=".github/assets/icons/selfhst/radarr.svg" alt="Radarr" width="42"><br>
      <strong>Radarr</strong>
    </td>
    <td align="center">
      <img src=".github/assets/icons/selfhst/lidarr.svg" alt="Lidarr" width="42"><br>
      <strong>Lidarr</strong>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src=".github/assets/icons/selfhst/readarr.svg" alt="Readarr" width="42"><br>
      <strong>Readarr</strong>
    </td>
    <td align="center">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/prowlarr.png" alt="Prowlarr" width="42"><br>
      <strong>Prowlarr</strong>
    </td>
    <td align="center">
      <img src=".github/assets/icons/selfhst/bazarr.svg" alt="Bazarr" width="42"><br>
      <strong>Bazarr</strong>
    </td>
    <td align="center">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/tdarr.png" alt="Tdarr" width="42"><br>
      <strong>Tdarr</strong>
    </td>
  </tr>
  <tr>
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
    <td align="center">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/rutorrent.png" alt="rTorrent" width="42"><br>
      <strong>rTorrent</strong>
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
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/unpackerr.png" alt="Unpackerr" width="42"><br>
      <strong>Unpackerr</strong>
    </td>
    <td align="center">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/autobrr.png" alt="autobrr" width="42"><br>
      <strong>autobrr</strong>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/wizarr.png" alt="Wizarr" width="42"><br>
      <strong>Wizarr</strong>
    </td>
    <td align="center">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/maintainerr.png" alt="Maintainerr" width="42"><br>
      <strong>Maintainerr</strong>
    </td>
    <td align="center">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/kometa.png" alt="Kometa" width="42"><br>
      <strong>Kometa</strong>
    </td>
    <td align="center">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/recyclarr.png" alt="Recyclarr" width="42"><br>
      <strong>Recyclarr</strong>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/notifiarr.png" alt="Notifiarr" width="42"><br>
      <strong>Notifiarr</strong>
    </td>
    <td align="center">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/audiobookshelf.png" alt="Audiobookshelf" width="42"><br>
      <strong>Audiobookshelf</strong>
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
  <tr>
    <td align="center">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/ntfy.png" alt="ntfy" width="42"><br>
      <strong>ntfy</strong>
    </td>
    <td align="center">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/telegram.png" alt="Telegram" width="42"><br>
      <strong>Telegram</strong>
    </td>
    <td align="center">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/pushover.png" alt="Pushover" width="42"><br>
      <strong>Pushover</strong>
    </td>
    <td align="center">
      <img src="https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/webhook.png" alt="Webhook" width="42"><br>
      <strong>Webhook</strong>
    </td>
  </tr>
</table>

## Quick start

### Docker Compose

Create a `docker-compose.yml` (or start from the one in this repo):

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

Start it with Docker Compose v2 (`docker compose`, with a space):

```sh
docker compose up -d
```

Then open `http://localhost:3000` and follow the setup:

1. Enter your Jellyfin or Emby server address, for example `http://192.168.1.10:8096`.
2. Add an API key from your media server's dashboard.
3. Choose how you sign in to JellyGlance and create the admin account.
4. Let the first sync run.

### docker run

Start PostgreSQL first, then:

```sh
docker run -d --name jellyglance --restart unless-stopped \
  -p 3000:3000 \
  -v ./config:/app/config \
  -v ./backups:/app/backups \
  -e POSTGRES_IP=jellyglance-db -e POSTGRES_PORT=5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=change-me -e POSTGRES_DB=jellyglance \
  -e JWT_SECRET=replace-me-with-a-long-random-secret \
  ghcr.io/jellyglance/server:latest
```

The container must be able to reach PostgreSQL by `POSTGRES_IP`, for example on the same Docker network.

### Proxmox LXC and Unraid

Scripts in [`packaging/`](packaging/README.md) set it up in an unprivileged Debian LXC on Proxmox VE, either by creating the container from the host (`create-lxc.sh`) or inside an existing one:

```sh
curl -fsSL https://raw.githubusercontent.com/JellyGlance/Server/main/packaging/proxmox/install-in-lxc.sh | bash
```

Unraid Community Applications templates and a Compose file are in [`packaging/unraid`](packaging/unraid).

### Persistent folders

| Host path | Container path | Used for |
| --- | --- | --- |
| `./config` | `/app/config` | Runtime config and local app files |
| `./backups` | `/app/backups` | Backup exports and restore uploads |
| `postgres-data` | PostgreSQL data volume | The database |

To restore a backup, put the JSON file in `./backups` or upload it from the Backup page.

## Configuration

These are the main environment variables. The full list is in the [configuration reference](https://docs.jellyglance.com/reference/configuration/).

| Variable | Default | What it does |
| --- | --- | --- |
| `POSTGRES_IP` | | PostgreSQL host |
| `POSTGRES_PORT` | | PostgreSQL port, usually `5432` |
| `POSTGRES_USER` | `postgres` | PostgreSQL user |
| `POSTGRES_PASSWORD` | | PostgreSQL password |
| `POSTGRES_DB` | | Database name |
| `POSTGRES_SSL_ENABLED` | `false` | Connect to PostgreSQL over TLS |
| `JWT_SECRET` | | **Required.** Signs sign-in tokens and, unless `INTEGRATION_SECRET_KEY` is set, encrypts saved integration secrets. Keep it the same across updates. |
| `INTEGRATION_SECRET_KEY` | `JWT_SECRET` | Separate key for encrypting integration secrets |
| `TZ` | | Time zone, for example `Europe/London` |
| `JS_PORT` | `3000` | Port inside the container (`PORT` also works) |
| `JS_LISTEN_IP` | `0.0.0.0` | Address to listen on |
| `JS_BASE_URL` | | Serve under a subpath, for example `/jellyglance` |
| `JS_PUBLIC_URL` | | Public address of JellyGlance, used in notification links |
| `JF_HOST` | | Jellyfin or Emby address. With `JF_API_KEY`, it skips the server step of setup and overrides the saved address. A trailing `/` is ignored. |
| `JF_API_KEY` | | API key for that server |
| `JF_SERVER_TYPE` | detected | `jellyfin` or `emby` |
| `JS_USER`, `JS_PASSWORD` | | Create the first local admin account without the setup screen |
| `REJECT_SELF_SIGNED_CERTIFICATES` | `true` | Set to `false` to allow self-signed HTTPS on your media server and apps |
| `JF_USE_WEBSOCKETS` | `true` | Set to `false` to poll for sessions instead of using WebSockets |
| `JS_GEOLITE_ACCOUNT_ID`, `JS_GEOLITE_LICENSE_KEY` | | Optional MaxMind GeoLite credentials to show where client IPs are |
| `GITHUB_TOKEN` | | Optional token for the update check and the About page, to avoid GitHub rate limits |
| `CONFIG_DIR`, `BACKUP_DIR` | `/app/config`, `/app/backups` | Where config and backups are stored |

## Updating

```sh
docker compose pull
docker compose up -d
```

Settings, history and your database are kept. **What's New** in the app shows the changes after each update, and [Releases](https://github.com/JellyGlance/Server/releases) has the full notes.

## Documentation

Guides live at **[docs.jellyglance.com](https://docs.jellyglance.com/)** (source in [JellyGlance/Documentation](https://github.com/JellyGlance/Documentation)):

- [Installation and first setup](https://docs.jellyglance.com/guide/getting-started/)
- [Integration directory](https://docs.jellyglance.com/integrations/)
- [Reverse proxy: Nginx, Caddy, Nginx Proxy Manager and Traefik](https://docs.jellyglance.com/operations/reverse-proxy/)
- [Configuration reference](https://docs.jellyglance.com/reference/configuration/)
- [Backup and restore](https://docs.jellyglance.com/operations/backup-restore/)
- [Troubleshooting](https://docs.jellyglance.com/guide/troubleshooting/)

Spotted a docs problem? [Open a docs issue](https://github.com/JellyGlance/Documentation/issues/new/choose).

## Community and support

- **Discord:** [discord.gg/dMGhv8j2kx](https://discord.gg/dMGhv8j2kx)
- **Questions and ideas:** [GitHub Discussions](https://github.com/JellyGlance/Server/discussions)
- **Bugs and feature requests:** [issues](https://github.com/JellyGlance/Server/issues/new/choose)
- **Security reports:** see [SECURITY.md](SECURITY.md)

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first, especially before changing widgets. To work on it locally:

```sh
npm ci
npm run dev     # API and web app with live reload
npm test        # API tests
npm run lint
npm run build
```

The website's source is in [JellyGlance/Website](https://github.com/JellyGlance/Website).

## License and credits

JellyGlance is released under the [MIT License](LICENSE). Created by **Nerdy-Technician**, inspired by **[Jellystat](https://github.com/CyferShepard/Jellystat)**. Thanks to everyone who has contributed. You're listed on the About page in the app.
