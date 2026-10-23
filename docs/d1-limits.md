# D1 limits

Cloudflare D1 limits that bit or can bite (https://developers.cloudflare.com/d1/platform/limits/). Each applies to every statement inside a `db.batch`.

| Limit | Value |
| --- | --- |
| bound parameters per statement | 100 |
| SQL statement length | 100,000 bytes |
| string / BLOB / row size | 2,000,000 bytes |
| `LIKE` / `GLOB` pattern | 50 bytes |
| arguments per SQL function | 32 |

Local SQLite (libsql, what the tests run on) allows 32766 parameters, so these only fail in production. In drizzle every value in `sql`${v}``, `eq`, `inArray`, `.values({...})` (every column that has a value or a `$defaultFn`), `.set({...})`, `.limit(n)` is one bound parameter; column references and `sql.raw` are not.

## Tests

`packages/db/src/test-d1.ts` exports `d1TestDb()` (client + drizzle `Database`) and `d1TestClient()` (client only; `{ migrations: (file) => file < X }` for migration tests). It applies every migration to an in-memory database and throws, as D1 does, on a statement or batch entry that binds more than 100 values (positional or named), is over 100 KB, binds a string/BLOB over 2 MB, or has a `LIKE`/`GLOB` pattern over 50 bytes; interactive transactions throw too (D1 has none, use `db.batch`). `packages/api/src/lib/d1-guard.test.ts` fails when any code outside the helper creates a libsql or `bun:sqlite` database, and when a `.values(rows)` takes anything but a literal row outside the files it lists.

The guard only sees what a test sends. A regression test for a caller-sized query feeds the real worst-case input through the router or store (the schema's `.max()`, the cap of the table) and checks the result, not only that nothing threw.

## Code

`packages/api/src/lib/d1.ts`:

- `insertChunked(db, table, rows, finish?)`: a multi-row insert as one statement per `floor(100 / columns)` rows, in one `db.batch` (one transaction); `finish` adds `.onConflictDoNothing()` / `.returning()`; answers one result per statement.
- `readChunked(keys, slice => query, { reserved, perKey })`: one query per slice of an `IN (...)` list; `reserved` is how many other values the query binds, `perKey: 2` for `(a, b) IN (VALUES (?, ?), ...)`.
- `chunk(items, size)`, `D1_MAX_PARAMS`, `rowsPerStatement(table)`.

An update or delete over a caller-sized id list is one statement per `chunk(ids, D1_MAX_PARAMS - otherBoundValues)` in one `db.batch`.

Lists that are bounded by a constant (a three-state `inArray`, a team capped at 20 members) need nothing, but say where the bound comes from when it is not obvious.
