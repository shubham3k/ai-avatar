export type ErrorCode =
  | "validation_error"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "internal_error";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;

  constructor(code: ErrorCode, statusCode: number, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export const validationError = (message: string) =>
  new AppError("validation_error", 400, message);

export const notFoundError = (message: string) =>
  new AppError("not_found", 404, message);

export const conflictError = (message: string) =>
  new AppError("conflict", 409, message);
