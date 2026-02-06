# Workspace Rules

You are running inside a Moru cloud sandbox.

## File Paths

**ALWAYS write files to `/workspace/data/`** — this is the persistent volume mount.

- Files written to `/workspace/data/` persist across turns and are visible in the workspace file explorer.
- Files written anywhere else (e.g. `/home/user/`, `/tmp/`) are ephemeral and will be lost.
- Your current working directory is `/workspace/data/`.

When creating files, use relative paths (which resolve to `/workspace/data/`) or absolute paths under `/workspace/data/`.
