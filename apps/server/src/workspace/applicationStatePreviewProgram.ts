/** Fixed operational queries only. The live app-owned WAL connection is
 * logically read-only; SQLite may still use or create WAL/SHM sidecars. */
export const APPLICATION_STATE_COLUMNS = {
  usage_stats_days: [
    "day",
    "generating_ms",
    "output_tokens",
    "user_messages",
    "input_tokens",
    "cached_input_tokens",
    "cache_write_input_tokens",
    "reasoning_output_tokens",
  ],
  projection_state: ["projector", "last_applied_sequence", "updated_at"],
} as const;
export const APPLICATION_STATE_PROJECTORS = [
  "projection.projects",
  "projection.threads",
  "projection.thread-messages",
  "projection.thread-proposed-plans",
  "projection.thread-activities",
  "projection.thread-sessions",
  "projection.thread-goals",
  "projection.thread-turns",
  "projection.checkpoints",
  "projection.pending-approvals",
  "provider-daemon-runtime-ingestion",
  "provider-supervisor-runtime-ingestion",
] as const;

export const APPLICATION_STATE_PREVIEW_PROGRAM =
  `const columnsByTable = ${JSON.stringify(APPLICATION_STATE_COLUMNS)};\nconst projectors = ${JSON.stringify(APPLICATION_STATE_PROJECTORS)};\n` +
  String.raw`
const { DatabaseSync } = require('node:sqlite');
const { constants, openSync, closeSync, fstatSync, lstatSync, realpathSync, readSync } = require('node:fs');
const { dirname, basename, resolve } = require('node:path');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; if (input.length > 16384) process.exit(1); });
process.stdin.on('end', () => {
  let db, descriptor;
  try {
    const request = JSON.parse(input);
    if (typeof request.filename !== 'string' || !['tables', 'rows'].includes(request.operation)) throw Error();
    const filename = resolve(realpathSync(dirname(request.filename)), basename(request.filename));
    descriptor = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
    const pinned = fstatSync(descriptor, { bigint: true });
    if (!pinned.isFile()) throw Error();
    const verify = () => {
      const named = lstatSync(request.filename, { bigint: true });
      const opened = fstatSync(descriptor, { bigint: true });
      if (!named.isFile() || named.isSymbolicLink() || !opened.isFile() || realpathSync(request.filename) !== filename ||
          named.dev !== pinned.dev || named.ino !== pinned.ino || opened.dev !== pinned.dev || opened.ino !== pinned.ino) throw Error();
    };
    verify();
    const header = Buffer.alloc(16);
    if (readSync(descriptor, header, 0, 16, 0) !== 16 || header.toString('binary') !== 'SQLite format 3\0') throw Error();
    db = new DatabaseSync(filename, { readOnly: true, allowExtension: false, enableDoubleQuotedStringLiterals: false, enableForeignKeyConstraints: false, timeout: 0 });
    verify();
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-2048; BEGIN');
    const tables = [];
    for (const table of Object.keys(columnsByTable)) {
      const found = db.prepare("SELECT type FROM pragma_table_list() WHERE schema='main' AND name=? LIMIT 1").get(table);
      if (!found) continue;
      if (found.type !== 'table') throw Error();
      const columns = columnsByTable[table];
      const metadata = [];
      for (const row of db.prepare('PRAGMA main.table_xinfo("' + table + '")').iterate()) {
        if (metadata.length === 64) throw Error();
        metadata.push(row);
      }
      if (!columns.every(name => metadata.some(row => row.name === name && row.hidden === 0))) throw Error();
      tables.push({ name: table });
    }
    let result = { database: 'cafe-code-state', tables };
    if (request.operation === 'rows') {
      if (!tables.some(table => table.name === request.table) || !Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100) throw Error();
      const columns = columnsByTable[request.table];
      // Reject unexpected types and oversized text before values reach JavaScript.
      // Preserve bounded text exactly: substr would hide suffixes after a NUL.
      const fields = columns.map((name, index) => {
        const column = '"' + name + '"';
        const text = index === 0 || (request.table === 'projection_state' && index === 2);
        return text
          ? "CASE WHEN typeof(" + column + ")='text' AND length(CAST(" + column + ' AS BLOB))<=128 THEN ' + column + ' ELSE NULL END'
          : "CASE WHEN typeof(" + column + ")='integer' THEN " + column + ' ELSE NULL END';
      });
      const statement = db.prepare('SELECT ' + fields.join(',') + ' FROM main."' + request.table + '" ORDER BY "' + columns[0] + '" LIMIT ?');
      statement.setReturnArrays(true);
      statement.setReadBigInts(true);
      const rows = [];
      let truncated = false;
      for (const values of statement.iterate(request.limit + 1)) {
        if (rows.length === request.limit) { truncated = true; break; }
        const row = values.map((value, index) => {
          if (typeof value === 'string' && value.length > 128) throw Error();
          if (request.table === 'usage_stats_days' && index === 0) {
            if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw Error();
            return value;
          }
          if (request.table === 'projection_state' && index === 0) {
            if (!projectors.includes(value)) throw Error();
            return value;
          }
          if (request.table === 'projection_state' && index === 2) {
            if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw Error();
            const normalized = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) => '.' + (fraction || '').padEnd(3, '0') + 'Z');
            if (new Date(value).toISOString() !== normalized) throw Error();
            return value;
          }
          if (typeof value !== 'bigint' || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw Error();
          return String(value);
        });
        rows.push(row);
      }
      result = { database: 'cafe-code-state', table: request.table, columns, rows, truncated };
    }
    verify();
    db.close(); db = undefined;
    verify();
    const output = JSON.stringify(result);
    if (Buffer.byteLength(output) > 65536) throw Error();
    process.stdout.write(output);
  } catch { process.exitCode = 1; }
  finally { try { db?.close(); } catch {} try { if (descriptor !== undefined) closeSync(descriptor); } catch {} }
});
`;
