/**
 * Security utilities for anti-reverse-engineering and protection
 * These measures help protect the application from automated attacks and scraping
 */

/**
 * Generate a fingerprint for the current browser/device
 * Used to detect suspicious activity and prevent account sharing
 */
export async function generateBrowserFingerprint(): Promise<string> {
  if (typeof window === "undefined") return "server";

  const components: string[] = [];

  // Screen resolution
  components.push(`${window.screen.width}x${window.screen.height}`);
  
  // Color depth
  components.push(`${window.screen.colorDepth}`);
  
  // Timezone
  components.push(Intl.DateTimeFormat().resolvedOptions().timeZone);
  
  // Language
  components.push(navigator.language);
  
  // Platform
  components.push(navigator.platform);
  
  // User agent (partial)
  components.push(navigator.userAgent.slice(0, 50));
  
  // Canvas fingerprint (basic)
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.textBaseline = "top";
      ctx.font = "14px Arial";
      ctx.fillText("Pryva", 2, 2);
      components.push(canvas.toDataURL().slice(0, 100));
    }
  } catch (e) {
    // Canvas not supported
  }

  // Hash the components
  const data = components.join("|");
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  
  return hash.slice(0, 32);
}

/**
 * Detect if the page is running in an automated environment
 */
export function detectAutomation(): { isAutomated: boolean; signals: string[] } {
  if (typeof window === "undefined") {
    return { isAutomated: false, signals: [] };
  }

  const signals: string[] = [];

  // Check for common automation indicators
  if ("webdriver" in navigator && (navigator as { webdriver?: boolean }).webdriver) {
    signals.push("webdriver");
  }

  // Check for headless browser indicators
  if (
    navigator.userAgent.includes("HeadlessChrome") ||
    navigator.userAgent.includes("PhantomJS")
  ) {
    signals.push("headless-browser");
  }

  // Check for missing plugins (common in headless browsers)
  if (navigator.plugins.length === 0) {
    signals.push("no-plugins");
  }

  // Check for unusual window dimensions
  if (window.outerWidth === 0 || window.outerHeight === 0) {
    signals.push("zero-outer-dimensions");
  }

  // Check for automation-related properties
  const automationProps = [
    "_phantom",
    "callPhantom",
    "__nightmare",
    "_Selenium_IDE_Recorder",
    "document.__selenium_unwrapped",
    "document.__webdriver_evaluate",
    "document.__driver_evaluate",
  ];

  for (const prop of automationProps) {
    if ((window as unknown as Record<string, unknown>)[prop]) {
      signals.push(prop);
    }
  }

  return {
    isAutomated: signals.length > 0,
    signals,
  };
}

/**
 * Rate limiting with exponential backoff
 */
export class RateLimiter {
  private attempts: Map<string, { count: number; lastAttempt: number; blockedUntil?: number }> =
    new Map();

  constructor(
    private maxAttempts: number = 5,
    private windowMs: number = 60000, // 1 minute
    private blockDurationMs: number = 300000, // 5 minutes
  ) {}

  check(key: string): { allowed: boolean; remaining: number; blockedUntil?: Date } {
    const now = Date.now();
    const record = this.attempts.get(key);

    if (!record) {
      this.attempts.set(key, { count: 1, lastAttempt: now });
      return { allowed: true, remaining: this.maxAttempts - 1 };
    }

    // Check if blocked
    if (record.blockedUntil && record.blockedUntil > now) {
      return {
        allowed: false,
        remaining: 0,
        blockedUntil: new Date(record.blockedUntil),
      };
    }

    // Reset if outside window
    if (now - record.lastAttempt > this.windowMs) {
      this.attempts.set(key, { count: 1, lastAttempt: now });
      return { allowed: true, remaining: this.maxAttempts - 1 };
    }

    // Increment attempts
    record.count++;
    record.lastAttempt = now;

    // Block if exceeded max attempts
    if (record.count > this.maxAttempts) {
      record.blockedUntil = now + this.blockDurationMs;
      return {
        allowed: false,
        remaining: 0,
        blockedUntil: new Date(record.blockedUntil),
      };
    }

    return {
      allowed: true,
      remaining: this.maxAttempts - record.count,
    };
  }

  reset(key: string) {
    this.attempts.delete(key);
  }
}

/**
 * Encrypt sensitive data before storing in localStorage
 */
export function encryptData(data: string, key: string): string {
  // Simple XOR encryption (for client-side obfuscation)
  // In production, use proper encryption libraries
  const keyChars = key.split("");
  const dataChars = data.split("");
  const encrypted = dataChars.map((char, i) => {
    const keyChar = keyChars[i % keyChars.length];
    return String.fromCharCode(char.charCodeAt(0) ^ keyChar.charCodeAt(0));
  });
  return btoa(encrypted.join(""));
}

/**
 * Decrypt data from localStorage
 */
export function decryptData(encrypted: string, key: string): string {
  try {
    const decoded = atob(encrypted);
    const keyChars = key.split("");
    const dataChars = decoded.split("");
    const decrypted = dataChars.map((char, i) => {
      const keyChar = keyChars[i % keyChars.length];
      return String.fromCharCode(char.charCodeAt(0) ^ keyChar.charCodeAt(0));
    });
    return decrypted.join("");
  } catch (e) {
    return "";
  }
}

/**
 * Generate a secure CSRF token
 */
export function generateCSRFToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate CSRF token
 */
export function validateCSRFToken(token: string, expected: string): boolean {
  if (!token || !expected) return false;
  if (token.length !== expected.length) return false;
  
  // Constant-time comparison to prevent timing attacks
  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Obfuscate email addresses to prevent scraping
 */
export function obfuscateEmail(email: string): string {
  const [local, domain] = email.split("@");
  const obfuscatedLocal = local.slice(0, 2) + "***" + local.slice(-1);
  return `${obfuscatedLocal}@${domain}`;
}

/**
 * Detect suspicious user behavior
 */
export function detectSuspiciousBehavior(): {
  suspicious: boolean;
  signals: string[];
} {
  if (typeof window === "undefined") {
    return { suspicious: false, signals: [] };
  }

  const signals: string[] = [];

  // Check if devtools might be open
  const devtoolsOpen =
    window.outerWidth - window.innerWidth > 160 ||
    window.outerHeight - window.innerHeight > 160;

  if (devtoolsOpen) {
    signals.push("devtools-possibly-open");
  }

  // Check for rapid page navigation (could indicate scraping)
  const navigationEntries = performance.getEntriesByType("navigation");
  if (navigationEntries.length > 10) {
    signals.push("rapid-navigation");
  }

  // Check for unusual viewport size
  if (window.innerWidth < 320 || window.innerHeight < 240) {
    signals.push("unusual-viewport");
  }

  return {
    suspicious: signals.length >= 2,
    signals,
  };
}
