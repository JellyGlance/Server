version: 1.3.4
title: JellyGlance v1.3.4
---
<div align="center">

# JellyGlance

### v1.3.4

![Version](https://img.shields.io/badge/version-1.3.4-6366f1?style=flat-square)
![Fixes](https://img.shields.io/badge/fixes-2-22c55e?style=flat-square)
![New](https://img.shields.io/badge/new%20features-1-f59e0b?style=flat-square)

**A media server connection test in Settings, a Deluge 2 fix, safer media server checks and cleaner restarts.**

</div>

<br>

> [!NOTE]
> Only admins can change or check the media server address now. Checks to loopback, link-local and cloud metadata addresses are refused, and redirects are not followed. Media servers on your LAN work exactly as before, and your settings, database and history are untouched.

<br>

## ✨ New

| | |
|---|---|
| **Test connection** | Settings → Media server has an admin-only panel that checks the saved Jellyfin or Emby address and API key live, with plain-language results |

<br>

## 🔧 Fixed

| | |
|---|---|
| **Deluge 2 connection test** | Testing a Deluge 2.x download client no longer fails with "Unknown method", and Deluge 1.3 keeps working |
| **Media server checks** | `/proxy/validateSettings`, `/api/setconfig` and `/api/setExternalUrl` are admin-only, and the address checks refuse loopback, link-local and metadata targets after DNS resolution, with no redirects |

<br>

## 🔐 Security

| | |
|---|---|
| **Dependencies** | qs 6.16.1, js-yaml 5.5.0 and React 19.3.1. nodemon is gone from the dev setup, which removes the vulnerable `braces` package |
| **Upgrade test** | The upgrade-path test's media server stub no longer writes request data to disk |

<br>

## 📝 Changes

### 🚀 Features

- feat(settings): add an admin-only media server connection test @Nerdy-Technician (#233)

### 🐛 Bug Fixes

- fix(downloads): use daemon.get_version for the Deluge connection test @Nerdy-Technician (#242)
- fix(api): guard media server probes and drop nodemon @Nerdy-Technician (#224)
- fix(ci): keep the upgrade test's stub request log in memory @Nerdy-Technician (#245)

### 🧰 Maintenance

- refactor(api): share one config-ready poll, stoppable timers and graceful shutdown @Nerdy-Technician (#225)
- chore(api): add ESLint and run it with the root lint @Nerdy-Technician (#226)
- ci: post the Mastodon release only after images are published @Nerdy-Technician (#227)
- chore: license the project as MIT to match LICENSE @Nerdy-Technician (#228)
- ci: make fork PR checks pass without secrets or Docker Hub quota @Nerdy-Technician (#231)
- ci: add an upgrade-path test from the latest release @Nerdy-Technician (#232)
- docs: drop the beta badge and fix the release and stars badges @Nerdy-Technician (#241)
- docs: what's new for v1.3.4 @Nerdy-Technician
- chore(deps): update eslint to 10.13.0 and qs to 6.16.1 @Nerdy-Technician (#246)
- chore(deps): update dependency js-yaml to v5.5.0 (#240)
- chore(deps): update production-dependencies to v19.3.1 (#238)
- chore(deps): update node.js to a5f4366 (#236)
- chore(deps): update github/codeql-action action to v4.39.0 (#239)
- chore(deps): update actions/create-github-app-token digest to 64ab729 (#229)

<br>

---

<div align="center">

**Full Changelog**: [`v1.3.3...v1.3.4`](https://github.com/JellyGlance/Server/compare/v1.3.3...v1.3.4)

</div>
