/** Quote CSV correctly and prevent untrusted text from becoming a spreadsheet formula. */
export function csvCell(value: unknown): string {
  let text = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (typeof value !== "number" && (/^[\t\r\n]/.test(text) || /^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(text))) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvRows(rows: unknown[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}
