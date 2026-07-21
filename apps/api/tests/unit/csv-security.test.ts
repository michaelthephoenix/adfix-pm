import { describe, expect, it } from "vitest";
import { escapeCsvField, toCsv } from "../../src/utils/csv.js";

describe("CSV export security", () => {
  it.each(["=1+1", "+cmd", "-2+3", "@SUM(A1:A2)", "\t=payload", "\r=payload"])(
    "neutralizes spreadsheet formula input %s",
    (value) => expect(escapeCsvField(value)).toBe(`'${value}`)
  );

  it("quotes delimiters after neutralizing formulas", () => {
    expect(escapeCsvField("=HYPERLINK(\"https://bad\",\"open\")")).toBe("\"'=HYPERLINK(\"\"https://bad\"\",\"\"open\"\")\"");
    expect(toCsv(["name"], [{ name: "=1+1" }])).toBe("name\n'=1+1");
  });
});
