# Contributing to JellyGlance

Thanks for helping out! Bugs and feature requests go in the [issue tracker](https://github.com/JellyGlance/Server/issues), and the full docs live at [docs.jellyglance.com](https://docs.jellyglance.com/). The docs source is in [JellyGlance/Documentation](https://github.com/JellyGlance/Documentation), and the jellyglance.com website is in [JellyGlance/Website](https://github.com/JellyGlance/Website).

## Run it locally

You need Node.js 22 or newer and a PostgreSQL database.

1. Start a database. The quickest way is Docker:

   ```sh
   docker run -d --name jellyglance-db -p 5432:5432 \
     -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=mypassword -e POSTGRES_DB=jellyglance \
     postgres:18-alpine
   ```

2. Copy `apps/api/.env.example` to `apps/api/.env` and fill in `POSTGRES_*` and a long random `JWT_SECRET`.
3. Install and run everything with one command:

   ```sh
   npm ci
   npm run dev
   ```

   The API runs on <http://localhost:3000> and the web app (Vite, with hot reload) on <http://localhost:3001>. Open the web app and follow the setup wizard.

To try the production image instead, run `docker compose -f docker-compose.local.yml up --build`, then open <http://localhost:3000>.

## Before you open a PR

```sh
npm test            # API tests
npm run lint        # ESLint for the API and web app
npm run i18n:check  # every locale has the keys in en-US
npm run build       # web build
```

CI runs the same checks.

## Branches and commits

- Branch off `main` and name it after the change: `fix/deluge-connection-test`, `feat/library-types`, `docs/readme-integrations`, `chore/...`, `ci/...`, `refactor/...`.
- Use [Conventional Commits](https://www.conventionalcommits.org/) with a scope, written in plain words: `fix(downloads): use daemon.get_version for the Deluge connection test`, `feat(settings): ...`, `docs: ...`, `chore(deps): ...`.
- PR titles follow the same style, because they become the squash-merge commit.

## What gets a PR merged quickly

- **Small and focused.** One fix or feature per PR. Split anything big, or open an issue first to agree the approach.
- **Linked issue.** Put `Fixes #123` in the description.
- **Tests.** Add or update tests under `apps/api/test/` for API changes.
- **Screenshots** (before and after) for anything that changes the UI.
- **Translations.** Add new strings to `en-US` and run `npm run i18n:sync`.
- **Green checks.** Tests, lint and build all pass.

## Widget changes: open the Website PR first

The downloadable Homarr widget files on jellyglance.com are generated from the app's widget pack (`apps/web/src/lib/widgetSnippets.js`) and live in JellyGlance/Website under `public/widgets/`. If your change alters them:

1. Clone the website next to this repo: `git clone https://github.com/JellyGlance/Website ../Website`. Or set `JG_WEBSITE_DIR` to an existing checkout.
2. Run `npm run widgets:sync` to regenerate the files, and `npm run widgets:check` to confirm they match.
3. Open the PR in JellyGlance/Website first, then the JellyGlance PR.

The **Widget Files** check runs only when the widget pack or `scripts/widget-files.mjs` changes. It reads Website's `main` and is non-blocking, so it shows a warning until the Website PR is merged.
