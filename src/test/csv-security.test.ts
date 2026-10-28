import { describe, expect, it } from "vitest";
import { csvCell, csvRows } from "@/lib/csv";

describe("CSV spreadsheet safety", () => {
  it.each(["=SUM(1,2)", "+1+2", "-1+2", "@HYPERLINK(\"x\")", "  =1+2", "\u00a0=1+2", "\tvalue", "\r=1"])(
    "neutralizes formula-like or control-prefixed text %j", (value) => {
      expect(csvCell(value)).toBe(`"'${value.replace(/"/g, '""')}"`);
    },
  );

  it("quotes commas, newlines and embedded quotes without creating extra cells", () => {
    expect(csvRows([["normal, value", 'said "hello"\nnext', 42, -7]])).toBe('"normal, value","said ""hello""\nnext","42","-7"');
  });
});
