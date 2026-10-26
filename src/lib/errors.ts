export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "Resource not found") {
    super(message, 404, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string = "Validation failed") {
    super(message, 400, "VALIDATION_ERROR");
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Unauthorized") {
    super(message, 401, "UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "Forbidden") {
    super(message, 403, "FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string = "Conflict") {
    super(message, 409, "CONFLICT");
    this.name = "ConflictError";
  }
}

export class InsufficientBalanceError extends AppError {
  constructor(message: string = "Insufficient wallet balance") {
    super(message, 400, "INSUFFICIENT_BALANCE");
    this.name = "InsufficientBalanceError";
  }
}

export class ExpiredError extends AppError {
  constructor(message: string = "Resource has expired") {
    super(message, 400, "EXPIRED");
    this.name = "ExpiredError";
  }
}

export class AlreadyRedeemedError extends AppError {
  constructor(message: string = "Already redeemed") {
    super(message, 400, "ALREADY_REDEEMED");
    this.name = "AlreadyRedeemedError";
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = "Rate limit exceeded") {
    super(message, 429, "RATE_LIMIT");
    this.name = "RateLimitError";
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function handleError(error: unknown): { message: string; statusCode: number; code?: string } {
  if (isAppError(error)) {
    return {
      message: error.message,
      statusCode: error.statusCode,
      code: error.code,
    };
  }

  if (error instanceof Error) {
    console.error("Unexpected error:", error);
    return {
      message: "An unexpected error occurred",
      statusCode: 500,
      code: "INTERNAL_ERROR",
    };
  }

  return {
    message: "An unknown error occurred",
    statusCode: 500,
    code: "UNKNOWN_ERROR",
  };
}
