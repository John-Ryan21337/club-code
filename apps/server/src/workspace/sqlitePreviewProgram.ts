/** Fixed child program: no user SQL, extensions, provider hooks or workspace writes.
 * DatabaseSync is synchronous and its timeout only bounds lock waits, so the
 * parent owns a hard process deadline. Node 24 API: https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
 * The child opens only an owned private snapshot, never the workspace database.
 */
export const SQLITE_PREVIEW_PROGRAM = String.raw`
const { DatabaseSync } = require('node:sqlite');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  if (input.length > 16384) process.exit(1);
});
process.stdin.on('end', () => {
  let db;
  try {
    const request = JSON.parse(input);
    if (!['tables', 'rows'].includes(request.operation)) throw Error();
    db = new DatabaseSync(request.filename, {
      readOnly: true, allowExtension: false, enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: false, timeout: 0
    });
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-2048; BEGIN');
    const secret = /pass(?:word)?|secret|token|api.?key|credential|authori[sz]ation|cookie|session/i;
    const validName = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('\0');
    const quote = value => '"' + value.replaceAll('"', '""') + '"';
    // table_list excludes views, virtual tables and their shadow tables.
    const names = [];
    let truncated = false;
    for (const row of db.prepare('PRAGMA main.table_list').iterate()) {
      if (row.schema !== 'main' || row.type !== 'table' || !validName(row.name) || row.name.startsWith('sqlite_') || secret.test(row.name)) continue;
      if (names.length === 200) { truncated = true; break; }
      names.push(row.name);
    }
    names.sort();
    let result;
    if (request.operation === 'tables') result = { tables: names.map(name => ({ name })), truncated };
    else {
      if (!validName(request.table) || !names.includes(request.table) || !Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100) throw Error();
      const metadata = db.prepare('PRAGMA main.table_xinfo(' + quote(request.table) + ')').all();
      // Generated columns can execute attacker-selected expressions. Omit all
      // hidden/generated columns; never evaluate them just to truncate a cell.
      const visible = metadata.filter(row => row.hidden === 0 && typeof row.name === 'string' && row.name.length <= 512 && !row.name.includes('\0'));
      const columns = visible.slice(0, 40).map(row => row.name);
      if (columns.length === 0) throw Error();
      truncated = metadata.length > columns.length;
      const fields = columns.map(name => {
        const column = quote(name);
        return 'CASE WHEN typeof(' + column + ")='blob' THEN '[blob omitted]' ELSE substr(CAST(" + column + ' AS TEXT),1,4097) END';
      });
      const statement = db.prepare('SELECT ' + fields.join(',') + ' FROM main.' + quote(request.table) + ' LIMIT ?');
      statement.setReturnArrays(true);
      const rows = [];
      let redacted = false;
      let bytes = Buffer.byteLength(JSON.stringify(columns)) + 2048;
      for (const values of statement.iterate(request.limit + 1)) {
        if (rows.length === request.limit) { truncated = true; break; }
        const labelledSecret = columns.some((name, index) => /^(?:key|name|setting|property)$/i.test(name) && secret.test(String(values[index] ?? '')));
        const row = values.map((value, index) => {
          if (secret.test(columns[index]) || (labelledSecret && /^(?:value|data|content)$/i.test(columns[index]))) { redacted = true; return '[redacted]'; }
          const text = value === null ? 'NULL' : String(value);
          if (text.length > 4096) truncated = true;
          return text.slice(0, 4096);
        });
        bytes += Buffer.byteLength(JSON.stringify(row)) + 1;
        if (bytes > 240 * 1024) { truncated = true; break; }
        rows.push(row);
      }
      result = { columns, rows, truncated, redacted };
    }
    const output = JSON.stringify(result);
    if (Buffer.byteLength(output) > 256 * 1024) throw Error();
    db.close(); db = undefined;
    process.stdout.write(output);
  } catch { process.exitCode = 1; }
  finally { try { db?.close(); } catch {} }
});
`;
