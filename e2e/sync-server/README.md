# Local LibreTube sync server

Start the isolated SQLite server used by the sync integration test. The
Compose service uses the current `latest-sqlite` image because the old
`main-sqlite` tag predates the versioned API and watch-history support.

```sh
docker compose -f e2e/sync-server/compose.yml up -d --wait
```

Run the focused test against it:

```sh
OPENTUBEX_SYNC_SERVER_URL=http://127.0.0.1:8080 pnpm test:e2e:network --grep "LibreTube sync server"
```

Stop it and delete its test data when finished:

```sh
docker compose -f e2e/sync-server/compose.yml down -v
```
