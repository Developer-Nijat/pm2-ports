# Changelog

## 1.0.1 - 2026-11-18

- README: npm badges, `npx` usage, Windows note, contributing section

## 1.0.0 - 2026-11-18

First npm release.

- `pm2-ports` CLI: table, `--all`, `--json`, `--help`, `--version`
- Port sources: `ss`, then `netstat`, then `lsof`
- Ports of forked child processes are attributed to their PM2 process
- Fixed: `pm2 jlist` output that starts with a `[PM2] ...` warning line (e.g. right
  after the daemon is spawned) was rejected as unreadable
- Process tree is read from `/proc` when `ps` is not installed (slim containers);
  before, ports of forked children were silently missing there
- An empty table explains why (no processes for this user / none online)
- Programs are run without a shell (`execFileSync` with fixed arguments)
- `NO_COLOR` is respected
