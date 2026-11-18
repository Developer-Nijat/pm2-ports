'use strict';
// Pure parsing / shaping functions. No I/O here, so every branch is unit-testable.

/**
 * Parse `pm2 jlist` output. PM2 can print lines such as "[PM2] Spawning PM2 daemon"
 * before the JSON, and those start with '[' too, so try each '[' until one parses.
 * @returns {Array|null} process list, or null when no JSON array is found
 */
function parsePm2List(raw) {
  if (typeof raw !== 'string') return null;
  for (let i = raw.indexOf('['); i !== -1; i = raw.indexOf('[', i + 1)) {
    try {
      const list = JSON.parse(raw.slice(i));
      if (Array.isArray(list)) return list;
    } catch {
      // not the JSON start, keep looking
    }
  }
  return null;
}

/** Parse `ps -eo pid=,ppid=` into Map<ppid, pid[]> (all values strings). */
function parseProcessTree(raw) {
  const children = new Map();
  for (const line of String(raw || '').split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!m) continue;
    const [, pid, ppid] = m;
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  return children;
}

/**
 * Parent pid from the contents of /proc/<pid>/stat: "pid (comm) state ppid ...".
 * comm may contain spaces and ')' so split after the LAST ')'.
 * @returns {string|null}
 */
function ppidFromProcStat(stat) {
  const s = String(stat || '');
  const end = s.lastIndexOf(')');
  if (end === -1) return null;
  const fields = s.slice(end + 1).trim().split(/\s+/);
  return /^\d+$/.test(fields[1] || '') ? fields[1] : null;
}

/** The pid itself plus every descendant (a forked child may own the socket). */
function descendants(children, pid) {
  const out = new Set([String(pid)]);
  const stack = [String(pid)];
  while (stack.length) {
    for (const c of children.get(stack.pop()) || []) {
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
    }
  }
  return out;
}

function portOf(address) {
  const port = Number(String(address).split(':').pop());
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

function addPort(map, pid, address) {
  const port = portOf(address);
  if (port === null) return;
  if (!map.has(pid)) map.set(pid, new Set());
  map.get(pid).add(port);
}

/** Parse `ss -ltnpH` into Map<pid, Set<port>>. */
function parseSs(raw) {
  const map = new Map();
  for (const line of String(raw || '').split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    for (const m of line.matchAll(/pid=(\d+)/g)) addPort(map, m[1], cols[3]);
  }
  return map;
}

/** Parse `netstat -ltnp` into Map<pid, Set<port>>. */
function parseNetstat(raw) {
  const map = new Map();
  for (const line of String(raw || '').split('\n')) {
    const m = line.match(/^tcp\S*\s+\d+\s+\d+\s+(\S+)\s+\S+\s+LISTEN\s+(\d+)\//);
    if (m) addPort(map, m[2], m[1]);
  }
  return map;
}

/** Parse `lsof -nP -iTCP -sTCP:LISTEN` into Map<pid, Set<port>>. */
function parseLsof(raw) {
  const map = new Map();
  for (const line of String(raw || '').split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 3) continue;
    const addr = cols[cols.length - 2];
    if (/^\d+$/.test(cols[1]) && addr) addPort(map, cols[1], addr);
  }
  return map;
}

/** Join PM2 processes with listening ports. */
function buildRows(procs, children, pidPorts, { showAll = false } = {}) {
  return procs
    .filter((p) => p && p.pm2_env && (showAll || p.pm2_env.status === 'online'))
    .map((p) => {
      const ports = new Set();
      if (p.pid) {
        for (const d of descendants(children, p.pid)) {
          for (const port of pidPorts.get(d) || []) ports.add(port);
        }
      }
      const env = p.pm2_env.env || {};
      return {
        id: p.pm_id,
        name: String(p.name),
        status: p.pm2_env.status,
        pid: p.pid || null,
        env_port: env.PORT ? String(env.PORT) : null,
        ports: [...ports].sort((a, b) => a - b),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}

/** Render rows as an aligned table. `color` adds ANSI colours. */
function formatTable(rows, { color = false } = {}) {
  const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  const headers = ['id', 'name', 'status', 'pid', 'ports', 'env PORT'];
  const data = rows.map((r) => [
    String(r.id),
    r.name,
    r.status,
    r.pid ? String(r.pid) : '-',
    r.ports.length ? r.ports.join(', ') : '-',
    r.env_port || '-',
  ]);
  const widths = headers.map((h, i) => Math.max(h.length, ...data.map((d) => d[i].length)));
  const fmt = (cells, colored) =>
    cells
      .map((v, i) => {
        const s = v.padEnd(widths[i]);
        if (!colored) return s;
        if (i === 2) return v === 'online' ? c(32, s) : c(31, s);
        if (i === 4) return v === '-' ? c(90, s) : c(36, s);
        return s;
      })
      .join('  ')
      .trimEnd();
  const lines = [c(1, fmt(headers, false)), c(90, widths.map((w) => '─'.repeat(w)).join('──'))];
  for (const d of data) lines.push(fmt(d, true));
  return lines.join('\n');
}

module.exports = {
  parsePm2List,
  parseProcessTree,
  ppidFromProcStat,
  descendants,
  parseSs,
  parseNetstat,
  parseLsof,
  buildRows,
  formatTable,
};
