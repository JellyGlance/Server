version: 1.3.3
title: JellyGlance v1.3.3
---
<div align="center">

# JellyGlance

### v1.3.3

![Version](https://img.shields.io/badge/version-1.3.3-6366f1?style=flat-square)
![Fixes](https://img.shields.io/badge/fixes-1-22c55e?style=flat-square)

**JellyGlance now lives at [JellyGlance/Server](https://github.com/JellyGlance/Server) and is published to `ghcr.io/jellyglance/server`.**

</div>

<br>

> [!IMPORTANT]
> **v1.3.3 is only published to the new image.** If you are still on the old `ghcr.io/nerdy-technician/jellyglance` image, change your `image:` line to `ghcr.io/jellyglance/server:latest`, then pull and restart. Your settings, database and history are untouched. See the [v1.3.2 notes](https://github.com/JellyGlance/Server/releases/tag/v1.3.2) for full steps.

<br>

## 🔧 Fixed

| | |
|---|---|
| **Trailing slash in the server address** | A Jellyfin or Emby address ending in `/` no longer causes `//Users` 404s. Saved addresses and `JF_HOST` are cleaned up automatically, and subpaths like `/jellyfin` keep working |

<br>

## 📝 Changes

### 🐛 Bug Fixes

- fix: strip trailing slash from Jellyfin/Emby URL @Nerdy-Technician (#216)

### 🧰 Maintenance

- ci: publish to ghcr.io/jellyglance/server, with optional legacy push @Nerdy-Technician (#211)
- docs: point links and images at JellyGlance/Server @Nerdy-Technician (#212)
- docs: point documentation links at JellyGlance/Documentation @Nerdy-Technician (#213)
- docs: what's new for v1.3.3 and update repo links @Nerdy-Technician
- chore(deps): update dependency fast-uri to v4.2.2 (#214)

<br>

---

<div align="center">

**Full Changelog**: [`v1.3.2...v1.3.3`](https://github.com/JellyGlance/Server/compare/v1.3.2...v1.3.3)

</div>
