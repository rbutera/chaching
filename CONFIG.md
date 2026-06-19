# chaching Configuration

chaching reads configuration from:

```sh
${XDG_CONFIG_HOME:-$HOME/.config}/chaching/config.json
```

If the file is missing or malformed, chaching falls back to safe defaults:
Claude Code, Codex, and OpenCode local providers are enabled; Cursor Admin API is disabled.

Start from the example:

```sh
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/chaching"
cp config.example.json "${XDG_CONFIG_HOME:-$HOME/.config}/chaching/config.json"
```

## Server

```json
"server": {
	"host": "0.0.0.0",
	"port": 5178
}
```

The `chaching` CLI uses these values unless `HOST` or `PORT` is already set in the environment.

## Providers

### Claude Code

```json
"claude": {
	"enabled": true,
	"roots": ["~/.claude", "~/.config/claude"]
}
```

chaching scans `projects/**/*.jsonl` under each root. Claude Code logs are read-only and de-duplicated by message/request id.

### Codex

```json
"codex": {
	"enabled": true,
	"root": "~/.codex/sessions"
}
```

Codex usage is read from local JSONL session files. chaching uses `last_token_usage`, not cumulative totals, so repeated turn snapshots do not inflate spend.

### OpenCode

```json
"opencode": {
	"enabled": true,
	"dbPath": "~/.local/share/opencode/opencode.db"
}
```

OpenCode usage is read from the local SQLite session table through Node's built-in `node:sqlite` module. chaching requires Node `>=24.16.0` for this provider.

### Cursor

```json
"cursor": {
	"enabled": false,
	"adminApiToken": "",
	"email": null,
	"pollSeconds": 3600
}
```

Cursor is disabled by default because it uses the Cursor Admin API. Set `enabled` to `true` and provide an admin API token to poll `POST https://api.cursor.com/teams/filtered-usage-events`. `chargedCents` is treated as the authoritative cost. Cursor events do not provide local project/session attribution, so chaching groups them by Cursor user or service account.

## Publish Checklist

Before publishing externally, choose and record:

- Package name or npm scope.
- License.
- Public repository URL.
- Whether this directory becomes a standalone repo or a submodule of the focused workspace.

Do not run `npm publish`, create a GitHub repo, or edit `.gitmodules` until those choices are confirmed.
