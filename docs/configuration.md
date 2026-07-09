# Configuration

App-level settings live in the **⚙ Settings** UI (active project, the OpenRouter
key/model, the research horizon, the companion mod, backup/share). The environment
variables below are for source runs and overrides — set them in `app/.env.local`
(or the process environment). All are optional.

| Setting               | Default                                             | Purpose                                                                                                      |
| --------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `FACTORIO_BIN`        | `~/.local/share/Steam/.../bin/x64/factorio`         | Path to the Factorio executable used for data syncs.                                                         |
| `FACTORIO_DATA_DIR`   | `~/.factorio`                                       | Factorio user data (mods, `script-output`).                                                                  |
| `OPENROUTER_API_KEY`  | —                                                   | AI **Assistant** key. Set here _or_ in **Settings → Assistant** (env wins).                                  |
| `PYOPS_AGENT_MODEL`   | `~anthropic/claude-sonnet-latest`                   | Any OpenRouter model id. Set here, per chat, or in **Settings → Assistant** (env wins).                      |
| `PYOPS_BRIDGE_PORT`   | `37657`                                             | UDP port the app's bridge listens on (the mod's send target). Use a _different_ port for `--enable-lua-udp`. |
| `PYOPS_DATA_DIR`      | working dir (dev) / per-OS user data dir (packaged) | Where `projects/*.db` and `app-config.json` live. See `app/src/server/paths.server.ts`.                      |
| `DATABASE_URL`        | active project's file (else `projects/default.db`)  | Override the local SQLite file directly.                                                                     |
| `PYOPS_ALLOWED_HOSTS` | tunnel providers' domains                           | Extra hostnames the dev server accepts (comma-separated, or `true` to allow any) — for custom tunnels.       |

Reaching the dev server remotely (phone, another machine) is handled by
[`scripts/tunnel-dev`](../scripts/tunnel-dev) — it auto-picks cloudflared / ngrok /
tailscale and exposes `:3000`; run `scripts/tunnel-dev --help` for provider and
custom-hostname options.
