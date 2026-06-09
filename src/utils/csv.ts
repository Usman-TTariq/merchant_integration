export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function csvRow(fields: Array<string | number | null | undefined>): string {
  return fields.map((f) => csvEscape(f == null ? "" : String(f))).join(",");
}
