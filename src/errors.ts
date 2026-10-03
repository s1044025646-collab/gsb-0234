export type ErrorCode =
  | "INVALID_PARAM"
  | "DOCUMENT_TOO_LARGE"
  | "SELECTOR_TOO_LONG"
  | "SELECTOR_SYNTAX"
  | "UNSUPPORTED_SELECTOR"
  | "NOT_FOUND"
  | "EMPTY_DOCUMENT"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly detail?: string;
  readonly position?: number;

  constructor(code: ErrorCode, message: string, opts?: { detail?: string; position?: number }) {
    super(message);
    this.name = "AppError";
    this.code = code;
    if (opts?.detail !== undefined) this.detail = opts.detail;
    if (opts?.position !== undefined) this.position = opts.position;
  }
}

export const HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_PARAM: 400,
  DOCUMENT_TOO_LARGE: 413,
  SELECTOR_TOO_LONG: 413,
  SELECTOR_SYNTAX: 400,
  UNSUPPORTED_SELECTOR: 400,
  EMPTY_DOCUMENT: 400,
  NOT_FOUND: 404,
  INTERNAL: 500,
};
