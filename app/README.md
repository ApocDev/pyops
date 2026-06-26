# PyOps — `app/`

This is the [TanStack Start](https://tanstack.com/start) application: the whole
PyOps product in one process — the React UI **and** the backend (server functions +
Nitro routes), hosting the SQLite store, the block solver, the Factorio UDP bridge,
the data-dump + icon pipeline, and the AI assistant.

For what PyOps is, how to install it, and configuration, see the
[**root README**](../README.md).

## Working in here

The app uses [Vite+](https://viteplus.dev/) (the `vp` CLI). From this directory:

```bash
vp install        # install dependencies (after pulling)
vp dev            # dev server at http://localhost:3000
vp check          # format + lint + typecheck — keep this clean
vp test           # run the Vitest suite
```

Database (drizzle-kit): `pnpm db:generate` / `db:migrate` / `db:push` / `db:studio`,
and `pnpm db:import` to load the Factorio data dump.

See [`AGENTS.md`](AGENTS.md) for the full toolchain notes and conventions, and the
[root `AGENTS.md`](../AGENTS.md) for the overall architecture.
