'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parsePm2List,
  parseProcessTree,
  descendants,
  parseSs,
  parseNetstat,
  parseLsof,
  buildRows,
  formatTable,
} = require('../lib/parse');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ppidFromProcStat } = require('../lib/parse');
const { collectListeningPorts, collectProcessTree } = require('../lib/collect');

test('ppidFromProcStat handles spaces and parentheses in the command name', () => {
  assert.equal(ppidFromProcStat('473 (node) S 456 473 444 0 -1'), '456');
  assert.equal(ppidFromProcStat('9 (my (weird) app) R 1 9 9'), '1');
  assert.equal(ppidFromProcStat('garbage'), null);
});

test('collectProcessTree falls back to /proc when ps is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm2ports-proc-'));
  try {
    for (const [pid, ppid] of [['456', '444'], ['473', '456']]) {
      fs.mkdirSync(path.join(dir, pid));
      fs.writeFileSync(path.join(dir, pid, 'stat'), `${pid} (node) S ${ppid} 0 0`);
    }
    fs.mkdirSync(path.join(dir, 'self')); // non-numeric entries are skipped
    const tree = collectProcessTree(() => null, dir);
    assert.deepEqual([...descendants(tree, 456)].sort(), ['456', '473']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const toObj = (map) => Object.fromEntries([...map].map(([k, v]) => [k, [...v].sort((a, b) => a - b)]));

test('parsePm2List ignores warnings before the JSON', () => {
  const raw = '[PM2] Spawning PM2 daemon\n[{"pm_id":0,"name":"api"}]';
  assert.deepEqual(parsePm2List(raw), [{ pm_id: 0, name: 'api' }]);
});

test('parsePm2List handles an empty process list after warnings', () => {
  assert.deepEqual(parsePm2List('[PM2][WARN] Current process list is not synchronized\n[]'), []);
});

test('parsePm2List returns null on garbage, non-arrays and null', () => {
  assert.equal(parsePm2List(null), null);
  assert.equal(parsePm2List('not json'), null);
  assert.equal(parsePm2List('[broken'), null);
});

test('parseProcessTree + descendants walk the whole subtree', () => {
  const tree = parseProcessTree('  1     0\n 100     1\n 200   100\n 300   200\n 400     1\nbogus\n');
  assert.deepEqual([...descendants(tree, 100)].sort(), ['100', '200', '300']);
  assert.deepEqual([...descendants(tree, 999)], ['999']);
});

test('parseSs reads IPv4, IPv6 and wildcard addresses', () => {
  const raw = [
    'LISTEN 0 511 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=955,fd=20))',
    'LISTEN 0 511 [::]:3000 [::]:* users:(("node",pid=955,fd=21))',
    'LISTEN 0 511 *:9229 *:* users:(("node",pid=976,fd=22),("node",pid=977,fd=22))',
    'LISTEN 0 128 127.0.0.1:22 0.0.0.0:*',
  ].join('\n');
  assert.deepEqual(toObj(parseSs(raw)), { 955: [3000], 976: [9229], 977: [9229] });
});

test('parseNetstat reads LISTEN lines only', () => {
  const raw = [
    'Active Internet connections (only servers)',
    'Proto Recv-Q Send-Q Local Address  Foreign Address State  PID/Program name',
    'tcp        0      0 0.0.0.0:5000   0.0.0.0:*       LISTEN 940/node',
    'tcp6       0      0 :::4001        :::*            LISTEN 976/node',
    'tcp        0      0 0.0.0.0:22     0.0.0.0:*       LISTEN -',
  ].join('\n');
  assert.deepEqual(toObj(parseNetstat(raw)), { 940: [5000], 976: [4001] });
});

test('parseLsof skips the header and reads the address column', () => {
  const raw = [
    'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME',
    'node    955 app  20u IPv4 12345 0t0 TCP *:3000 (LISTEN)',
    'node    955 app  21u IPv6 12346 0t0 TCP [::1]:3001 (LISTEN)',
  ].join('\n');
  assert.deepEqual(toObj(parseLsof(raw)), { 955: [3000, 3001] });
});

test('invalid ports are dropped', () => {
  assert.deepEqual(toObj(parseSs('LISTEN 0 1 0.0.0.0:abc 0.0.0.0:* users:(("x",pid=1,fd=1))')), {});
});

const procs = [
  { pm_id: 2, name: 'web', pid: 300, pm2_env: { status: 'online', env: { PORT: 8080 } } },
  { pm_id: 1, name: 'api', pid: 100, pm2_env: { status: 'online', env: {} } },
  { pm_id: 3, name: 'worker', pid: 0, pm2_env: { status: 'stopped', env: {} } },
];

test('buildRows joins ports from child processes and sorts by name', () => {
  const tree = parseProcessTree('100 1\n150 100\n300 1\n');
  const ports = new Map([
    ['150', new Set([5001])],
    ['100', new Set([9229])],
    ['300', new Set([3000])],
  ]);
  const rows = buildRows(procs, tree, ports);
  assert.deepEqual(rows, [
    { id: 1, name: 'api', status: 'online', pid: 100, env_port: null, ports: [5001, 9229] },
    { id: 2, name: 'web', status: 'online', pid: 300, env_port: '8080', ports: [3000] },
  ]);
});

test('buildRows --all includes stopped processes without a pid', () => {
  const rows = buildRows(procs, new Map(), new Map(), { showAll: true });
  assert.deepEqual(
    rows.map((r) => [r.name, r.pid, r.ports]),
    [['api', 100, []], ['web', 300, []], ['worker', null, []]],
  );
});

test('formatTable aligns columns and has no colour codes by default', () => {
  const out = formatTable([
    { id: 1, name: 'api', status: 'online', pid: 100, env_port: null, ports: [5001, 9229] },
  ]);
  const [header, , row] = out.split('\n');
  assert.equal(header, 'id  name  status  pid  ports       env PORT');
  assert.equal(row, '1   api   online  100  5001, 9229  -');
  assert.doesNotMatch(out, /\x1b\[/);
});

test('collectListeningPorts falls back ss -> netstat -> lsof', () => {
  const calls = [];
  const run = (file) => {
    calls.push(file);
    return file === 'lsof' ? 'HEADER\nnode 7 u 1u IPv4 1 0t0 TCP *:80 (LISTEN)' : null;
  };
  const result = collectListeningPorts(run);
  assert.equal(result.tool, 'lsof');
  assert.deepEqual(calls, ['ss', 'netstat', 'lsof']);
  assert.deepEqual(toObj(result.pidPorts), { 7: [80] });
  assert.equal(collectListeningPorts(() => null), null);
});
