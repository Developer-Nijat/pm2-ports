# pm2-ports

[![npm version](https://img.shields.io/npm/v/pm2-ports.svg)](https://www.npmjs.com/package/pm2-ports)
[![npm downloads](https://img.shields.io/npm/dm/pm2-ports.svg)](https://www.npmjs.com/package/pm2-ports)
[![license](https://img.shields.io/npm/l/pm2-ports.svg)](LICENSE)
[![node](https://img.shields.io/node/v/pm2-ports.svg)](https://nodejs.org)

Show which TCP ports your [PM2](https://pm2.keymetrics.io/) processes are **really** listening on.

```
$ pm2-ports
id  name               status  pid  ports       env PORT
13  api-gateway        online  955  3000        3000
11  backend            online  940  5000        -
17  edge-relay         online  976  4001, 9229  4001
```

`pm2 list` tells you what is running, not which port it took. `pm2-ports` joins the PM2
process list with the kernel's listening sockets, including sockets opened by child
processes the app forked.

- Zero dependencies, a single small CLI
- Works with `ss`, `netstat` or `lsof` (whichever the server has)
- Table for humans, `--json` for scripts and monitoring

## Install

```bash
npm install -g pm2-ports
```

Or run it once without installing:

```bash
npx pm2-ports
```

Requires Node.js 18+ on Linux (macOS works through `lsof`), PM2, and one of `ss`
(package `iproute2`, present on most distributions), `netstat` or `lsof`.

> **Windows is not supported.** The tool relies on `ss` / `netstat` / `lsof` and
> `/proc`, so use it on your Linux or macOS server (or WSL).

### Servers without internet access

Build a tarball on a machine that has npm access, copy it over (scp, WinSCP, ...),
and install from the file:

```bash
npm pack pm2-ports            # creates pm2-ports-<version>.tgz
npm install -g ./pm2-ports-<version>.tgz
```

## Usage

```bash
pm2-ports            # online processes
pm2-ports --all      # include stopped / errored processes
pm2-ports --json     # JSON output
pm2-ports --help
pm2-ports --version
```

### Columns

| Column | Meaning |
|---|---|
| `ports` | Ports the process, or any child it forked, is listening on (from `ss` / `netstat` / `lsof`) |
| `env PORT` | The `PORT` environment variable PM2 passed to the process |

If the two differ, the app does not read `process.env.PORT` and has the port hard-coded.

### JSON

```bash
pm2-ports --json
```

```json
[
  { "id": 13, "name": "api-gateway", "status": "online", "pid": 955, "env_port": "3000", "ports": [3000] }
]
```

Processes that are online but listen on nothing:

```bash
pm2-ports --json | jq '.[] | select(.status == "online" and (.ports | length == 0)) | .name'
```

Colours are switched off when the output is not a terminal, or when `NO_COLOR` is set.

## Troubleshooting

**`pm2 not found, not running ...`**
Each Linux user has its own PM2 daemon. Run the command as the user that runs PM2:

```bash
sudo -u deploy pm2-ports
```

**The `ports` column shows `-` for everything**
Without root, `ss` / `netstat` do not show which process owns another user's sockets:

```bash
sudo pm2-ports
```

If `sudo` cannot find the command, call it by its full path: `sudo "$(which pm2-ports)"`.

**`None of ss, netstat or lsof is available`**

```bash
sudo apt install iproute2     # Debian / Ubuntu
sudo yum install iproute      # RHEL / CentOS
```

**`npm install -g` fails with `EACCES`**
Use a Node version manager (nvm, fnm) or set an npm prefix in your home directory:

```bash
npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | OK |
| 1 | PM2 or the port tools are not available |
| 2 | Unknown option |

## Contributing

Issues and pull requests are welcome at
[github.com/Developer-Nijat/pm2-ports](https://github.com/Developer-Nijat/pm2-ports/issues).
Run the tests with `npm test`.

## License

[MIT](LICENSE)
