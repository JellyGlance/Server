# JellyGlance packaging

Local packaging for **Unraid Community Apps** and **Proxmox LXC**.

## Database version and persistent data

The Compose files and Unraid database template use `postgres:18-alpine` for new installations. Postgres 18 defaults to `PGDATA=/var/lib/postgresql/18/docker`, so mount persistent data at `/var/lib/postgresql`, not the old `/var/lib/postgresql/data` path.

Do not switch an existing volume between major versions by changing the tag or mount. Dump with the old version, restore into a fresh Postgres 18 volume, and verify the restore before retiring the old data. Changing the mount does not migrate the database.

## Unraid store

Files in `unraid/templates/` are Community Applications XML templates.

### Use today (private / custom repo)

1. On Unraid: **Apps** → ⚙️ → **Template Repositories**
2. Add:
   `https://github.com/JellyGlance/Server`
   (CA looks under `/packaging/unraid/templates` only if configured; for stock CA, mirror these XMLs into a dedicated templates repo, or install via Compose below.)
3. Or install via **Compose Manager** using `unraid/docker-compose.yml` + `unraid/.env.example` under `/mnt/user/appdata/jellyglance/`.

### Recommended Unraid path

1. Create a custom Docker network (e.g. `jellyglance-net`).
2. Install **jellyglance-db**, attach to that network.
3. Install **jellyglance**, same network; set `POSTGRES_IP=jellyglance-db`, matching password, and a strong `JWT_SECRET`.
4. Open `http://<unraid-ip>:3000` and finish the first-run wizard.

### Submit to Community Apps

Point Squid’s CA maintainers at this folder (or a fork under `templates/*.xml` at repo root). Icons: `.github/assets/icon-b-512.png`.

## Proxmox LXC

### A) Create CT from the Proxmox host

```bash
# copy this repo (or just packaging/proxmox) onto the host, then:
cd packaging/proxmox
bash create-lxc.sh
# optional: CTID=130 HOSTNAME=jellyglance STORAGE=local-lvm bash create-lxc.sh
```

Creates an unprivileged Debian LXC with nesting, installs Docker, deploys the compose stack to `/opt/jellyglance`.

### B) Install into an existing LXC

```bash
pct enter <CTID>
# then inside:
bash /path/to/install-in-lxc.sh
# or:
curl -fsSL https://raw.githubusercontent.com/JellyGlance/Server/main/packaging/proxmox/install-in-lxc.sh | bash
```

## Build dist tarball

```bash
bash packaging/build.sh
# → packaging/dist/jellyglance-packaging-<version>.tar.gz
```
