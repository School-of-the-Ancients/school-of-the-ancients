export class SchoolError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export function requireValue(value: unknown, status: number, code: string, message: string): asserts value {
  if (!value) throw new SchoolError(status, code, message);
}
export function object(value: unknown): Record<string, unknown> {
  requireValue(!!value && typeof value === 'object' && !Array.isArray(value), 400, 'invalid_request', 'Provide a JSON object.');
  return value as Record<string, unknown>;
}
export function fields(body: Record<string, unknown>, allowed: string[], required: string[]) {
  requireValue(Object.keys(body).every((key) => allowed.includes(key)) && required.every((key) => Object.hasOwn(body, key)), 400, 'invalid_request', 'Unexpected or missing request fields.');
}
export function identifier(value: unknown, label = 'identifier'): string {
  requireValue(typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value), 400, 'invalid_request', `Invalid ${label}.`);
  return value;
}
export function learnerText(value: unknown, required: boolean): string {
  if (value === undefined && !required) return '';
  requireValue(typeof value === 'string' && value.trim().length >= (required ? 1 : 0) && value.length <= 4000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value), 400, 'invalid_request', 'Enter a response of 1–4,000 characters.');
  return value.trim();
}
