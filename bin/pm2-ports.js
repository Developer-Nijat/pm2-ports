#!/usr/bin/env node
'use strict';

const { version } = require('../package.json');
const { run, collectListeningPorts, collectProcessTree } = require('../lib/collect');
const { parsePm2List, buildRows, formatTable } = require('../lib/parse');

const HELP = `pm2-ports ${version} - show which TCP ports your PM2 processes listen on

Usage:
  pm2-ports [options]

Options:
  --all          include stopped / errored processes (default: online only)
  --json         print JSON instead of a table
  -h, --help     show this help
  -v, --version  show the version

Columns:
  ports        ports the process (or any child it forked) really listens on
  env PORT     the PORT environment variable PM2 passed to the process

Notes:
  * Each Linux user has its own PM2 daemon - run pm2-ports as the user that
    runs PM2 (e.g. sudo -u deploy pm2-ports).
  * If the ports column shows "-", try: sudo pm2-ports

Examples:
  pm2-ports
  pm2-ports --all
  pm2-ports --json | jq '.[] | select(.ports | length == 0)'
`;

function main(argv) {
  const args = new Set(argv);
  if (args.has('-h') || args.has('--help')) {
    process.stdout.write(HELP);
    return 0;
  }
  if (args.has('-v') || args.has('--version')) {
    console.log(version);
    return 0;
  }
  for (const a of args) {
    if (a !== '--all' && a !== '--json') {
      console.error(`Unknown option: ${a}\nRun "pm2-ports --help" for usage.`);
      return 2;
    }
  }

  const procs = parsePm2List(run('pm2', ['jlist']));
  if (!procs) {
    console.error('pm2 not found, not running, or "pm2 jlist" returned unreadable output');
    return 1;
  }

  const listening = collectListeningPorts();
  if (!listening) {
    console.error('None of ss, netstat or lsof is available (install iproute2)');
    return 1;
  }

  const children = collectProcessTree();
  const showAll = args.has('--all');
  const rows = buildRows(procs, children, listening.pidPorts, { showAll });

  if (args.has('--json')) {
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }

  const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
  const dim = (s) => (color ? `\x1b[90m${s}\x1b[0m` : s);
  console.log(formatTable(rows, { color }));

  if (!rows.length) {
    const user = process.env.USER || process.env.LOGNAME || 'this user';
    const why = procs.length && !showAll
      ? `No online PM2 processes (${procs.length} not online, see "pm2-ports --all").`
      : `No PM2 processes for ${user}. Each Linux user has its own PM2 daemon: run as the owner, e.g. "sudo -u <user> pm2-ports".`;
    console.log(dim(`\n* ${why}`));
    return 0;
  }

  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (!isRoot && rows.some((r) => r.status === 'online' && !r.ports.length)) {
    console.log(dim(`\n* Some processes show no ports: ${listening.tool} does not show other users' sockets without root. Try "sudo pm2-ports".`));
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
