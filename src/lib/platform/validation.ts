/**
 * Comprehensive validation utilities for forms and API requests
 */

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

/**
 * Validate an email address
 */
export function validateEmail(email: string): string | null {
  if (!email || typeof email !== "string") {
    return "Email is required";
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return "Invalid email address";
  }

  if (email.length > 200) {
    return "Email too long";
  }

  return null;
}

/**
 * Validate a password
 */
export function validatePassword(password: string): string | null {
  if (!password || typeof password !== "string") {
    return "Password is required";
  }

  if (password.length < 8) {
    return "Password must be at least 8 characters";
  }

  if (password.length > 128) {
    return "Password too long";
  }

  return null;
}

/**
 * Validate a strong password (with complexity requirements)
 */
export function validateStrongPassword(password: string): string | null {
  const basicError = validatePassword(password);
  if (basicError) return basicError;

  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one uppercase letter";
  }

  if (!/[a-z]/.test(password)) {
    return "Password must contain at least one lowercase letter";
  }

  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one number";
  }

  return null;
}

/**
 * Validate a name
 */
export function validateName(name: string, fieldName = "Name"): string | null {
  if (!name || typeof name !== "string") {
    return `${fieldName} is required`;
  }

  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return `${fieldName} must be at least 2 characters`;
  }

  if (trimmed.length > 120) {
    return `${fieldName} too long`;
  }

  return null;
}

/**
 * Validate a phone number (Nigerian format)
 */
export function validatePhone(phone: string): string | null {
  if (!phone || typeof phone !== "string") {
    return "Phone number is required";
  }

  // Remove spaces and dashes
  const cleaned = phone.replace(/[\s-]/g, "");

  // Nigerian phone number patterns
  const patterns = [
    /^0[789][01]\d{8}$/, // 08012345678
    /^234[789][01]\d{8}$/, // 2348012345678
    /^\+234[789][01]\d{8}$/, // +2348012345678
  ];

  if (!patterns.some((p) => p.test(cleaned))) {
    return "Invalid Nigerian phone number";
  }

  return null;
}

/**
 * Validate an amount (for payments)
 */
export function validateAmount(amount: number, min = 100, max = 10000000): string | null {
  if (typeof amount !== "number" || isNaN(amount)) {
    return "Invalid amount";
  }

  if (amount < min) {
    return `Minimum amount is ₦${min}`;
  }

  if (amount > max) {
    return `Maximum amount is ₦${max.toLocaleString()}`;
  }

  return null;
}

/**
 * Validate a string length
 */
export function validateStringLength(
  value: string,
  fieldName: string,
  min = 1,
  max = 1000
): string | null {
  if (!value || typeof value !== "string") {
    return `${fieldName} is required`;
  }

  if (value.length < min) {
    return `${fieldName} must be at least ${min} characters`;
  }

  if (value.length > max) {
    return `${fieldName} must be less than ${max} characters`;
  }

  return null;
}

/**
 * Validate an object against a schema
 */
export function validateObject<T extends Record<string, unknown>>(
  data: T,
  schema: Record<keyof T, (value: unknown) => string | null>
): ValidationResult {
  const errors: Record<string, string> = {};

  for (const [key, validator] of Object.entries(schema)) {
    const error = validator(data[key as keyof T]);
    if (error) {
      errors[key] = error;
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Sanitize a string for display (prevent XSS)
 */
export function sanitizeString(value: string): string {
  return value
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;");
}
