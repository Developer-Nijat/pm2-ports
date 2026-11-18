'use strict';
// System calls. Kept apart from parse.js so the parsers can be tested without a server.
// execFileSync with fixed argument arrays: no shell is involved.

const fs = require('fs');
const { execFileSync } = require('child_process');
const {
  parseSs,
  parseNetstat,
  parseLsof,
  parseProcessTree,
  ppidFromProcStat,
} = require('./parse');

/** Run a program; return stdout, or null when it is missing or fails. */
function run(file, args) {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

const PORT_TOOLS = [
  { tool: 'ss', file: 'ss', args: ['-ltnpH'], parse: parseSs },
  { tool: 'netstat', file: 'netstat', args: ['-ltnp'], parse: parseNetstat },
  { tool: 'lsof', file: 'lsof', args: ['-nP', '-iTCP', '-sTCP:LISTEN'], parse: parseLsof },
];

/** First available of ss > netstat > lsof. Returns { tool, pidPorts } or null. */
function collectListeningPorts(exec = run) {
  for (const { tool, file, args, parse } of PORT_TOOLS) {
    const out = exec(file, args);
    if (out) return { tool, pidPorts: parse(out) };
  }
  return null;
}

/** Map<ppid, pid[]> straight from /proc (Linux), for systems without `ps` (slim containers). */
function readProcTree(procDir = '/proc') {
  const children = new Map();
  let entries;
  try {
    entries = fs.readdirSync(procDir);
  } catch {
    return children;
  }
  for (const pid of entries) {
    if (!/^\d+$/.test(pid)) continue;
    let stat;
    try {
      stat = fs.readFileSync(`${procDir}/${pid}/stat`, 'utf8');
    } catch {
      continue; // process exited while we were reading
    }
    const ppid = ppidFromProcStat(stat);
    if (!ppid) continue;
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  return children;
}

/** Process tree from `ps`, falling back to /proc. */
function collectProcessTree(exec = run, procDir = '/proc') {
  const out = exec('ps', ['-eo', 'pid=,ppid=']);
  if (out) {
    const tree = parseProcessTree(out);
    if (tree.size) return tree;
  }
  return readProcTree(procDir);
}

module.exports = { run, collectListeningPorts, collectProcessTree, readProcTree };
