import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCsv,
  toCsv,
  sqlLiteral,
  identifier,
  escapeHtml,
  resultObjects,
} from "../js/workbench/data.js";
test("CSV parses BOM, CRLF, quoted separators, escaped quotes and embedded newlines", () => {
  const parsed = parseCsv(
    '\uFEFFname,notes\r\n林晓,"one, two"\r\n陈一,"say ""hi""\nand bye"\r\n',
  );
  assert.deepEqual(parsed, {
    columns: ["name", "notes"],
    values: [
      ["林晓", "one, two"],
      ["陈一", 'say "hi"\nand bye'],
    ],
  });
});
test("CSV rejects malformed rows and duplicate headers before importing", () => {
  assert.throws(() => parseCsv("id,ID\n1,2"), /不能重复/);
  assert.throws(() => parseCsv("a,b\n1"), /第 2 行/);
  assert.throws(() => parseCsv('a\n"never closed'), /未闭合/);
  assert.throws(() => parseCsv('a\n"done"oops'), /无效字符/);
});
test("CSV export round-trips quotes, multiline Unicode and empty text", () => {
  const result = {
    columns: ["名字", "说明"],
    values: [
      ["林晓", 'a,"b"\nc'],
      ["", ""],
    ],
  };
  assert.deepEqual(parseCsv(toCsv(result)), result);
});
test("Identifiers, SQL string values and HTML remain data", () => {
  assert.equal(identifier('a"; DROP TABLE x;--'), '"a""; DROP TABLE x;--"');
  assert.equal(sqlLiteral("O'Brien's"), "'O''Brien''s'");
  assert.equal(sqlLiteral(new Uint8Array([0, 255])), "X'00ff'");
  assert.equal(sqlLiteral(9223372036854775807n), "9223372036854775807");
  assert.equal(
    escapeHtml("<img src=x onerror=alert(1)>"),
    "&lt;img src=x onerror=alert(1)&gt;",
  );
});
test("JSON conversion preserves duplicate column values, BLOBs and 64-bit integers", () => {
  const json = resultObjects({
    columns: ["id", "id", "binary", "large"],
    values: [[1, 2, new Uint8Array([15, 160]), 9223372036854775807n]],
  });
  assert.deepEqual(json, [
    {
      id: 1,
      id_2: 2,
      binary: { type: "blob", hex: "0fa0" },
      large: "9223372036854775807",
    },
  ]);
  assert.doesNotThrow(() => JSON.stringify(json));
});

test("JSON names never overwrite existing suffixed columns", () => {
  assert.deepEqual(
    resultObjects({ columns: ["id", "id", "id_2"], values: [[1, 2, 3]] }),
    [{ id: 1, id_2: 2, id_2_3: 3 }],
  );
});
