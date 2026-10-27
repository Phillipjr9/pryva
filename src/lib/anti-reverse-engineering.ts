/**
 * Anti-Reverse-Engineering Measures
 * Protects the application from hackers attempting to reverse engineer, debug, or tamper with the code
 */

/**
 * Detect if DevTools are open (basic detection)
 */
export function detectDevTools(): boolean {
  if (typeof window === "undefined") return false;

  const threshold = 160;
  const widthThreshold = window.outerWidth - window.innerWidth > threshold;
  const heightThreshold = window.outerHeight - window.innerHeight > threshold;

  return widthThreshold || heightThreshold;
}

/**
 * Anti-debugging: Detect if debugger is attached
 */
export function detectDebugger(): boolean {
  if (typeof window === "undefined") return false;

  const start = performance.now();
  // eslint-disable-next-line no-debugger
  debugger;
  const end = performance.now();
  
  // If execution took more than 100ms, debugger is likely attached
  return end - start > 100;
}

/**
 * Obfuscate sensitive strings at runtime
 */
export function obfuscateString(str: string): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  
  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    const obfuscated = (charCode + i) % chars.length;
    result += chars[obfuscated];
  }
  
  return result;
}

/**
 * Deobfuscate strings
 */
export function deobfuscateString(obfuscated: string): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  
  for (let i = 0; i < obfuscated.length; i++) {
    const index = chars.indexOf(obfuscated[i]);
    const charCode = (index - i + chars.length) % chars.length;
    result += String.fromCharCode(charCode);
  }
  
  return result;
}

/**
 * Code integrity check - verify critical functions haven't been tampered with
 */
export class IntegrityChecker {
  private checksums: Map<string, string> = new Map();

  /**
   * Register a function for integrity checking
   */
  registerFunction(name: string, fn: Function): void {
    const fnString = fn.toString();
    const checksum = this.simpleHash(fnString);
    this.checksums.set(name, checksum);
  }

  /**
   * Verify function integrity
   */
  verifyFunction(name: string, fn: Function): boolean {
    const expected = this.checksums.get(name);
    if (!expected) return false;

    const current = this.simpleHash(fn.toString());
    return expected === current;
  }

  /**
   * Simple hash function for integrity checks
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }
}

/**
 * Anti-tampering: Detect code injection attempts
 */
export function detectCodeInjection(): boolean {
  if (typeof window === "undefined") return false;

  const suspiciousGlobals = [
    "eval",
    "Function",
    "setTimeout",
    "setInterval",
  ];

  // Check if critical globals have been overridden
  for (const global of suspiciousGlobals) {
    const fn = (window as unknown as Record<string, unknown>)[global];
    if (typeof fn !== "function") {
      return true;
    }
    
    // Check if function has been modified
    const fnString = fn.toString();
    if (fnString.includes("[native code]") === false && global === "eval") {
      return true;
    }
  }

  return false;
}

/**
 * Protect against prototype pollution
 */
export function lockPrototype(obj: object): void {
  if (typeof Object.freeze === "function") {
    Object.freeze(obj);
  }
}

/**
 * Detect if running in an iframe (potential clickjacking)
 */
export function detectIframe(): boolean {
  if (typeof window === "undefined") return false;
  
  try {
    return window.self !== window.top;
  } catch (e) {
    return true;
  }
}

/**
 * Anti-scraping: Detect automated requests
 */
export function detectScraping(): { isScraping: boolean; signals: string[] } {
  if (typeof window === "undefined") {
    return { isScraping: false, signals: [] };
  }

  const signals: string[] = [];

  // Check for missing browser features common in scrapers
  if (!window.localStorage) signals.push("no-localstorage");
  if (!window.sessionStorage) signals.push("no-sessionstorage");
  if (!window.indexedDB) signals.push("no-indexeddb");
  
  // Check for unusual user agent
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("bot") || ua.includes("crawler") || ua.includes("spider")) {
    signals.push("bot-user-agent");
  }

  // Check for missing plugins
  if (navigator.plugins.length === 0 && !ua.includes("firefox")) {
    signals.push("no-plugins");
  }

  // Check for disabled JavaScript features
  if (typeof window.crypto === "undefined") {
    signals.push("no-crypto");
  }

  return {
    isScraping: signals.length >= 2,
    signals,
  };
}

/**
 * Honeypot: Detect if someone is analyzing the code
 */
export function createHoneypot(): void {
  if (typeof window === "undefined") return;

  // Create suspicious-looking variables that legitimate code wouldn't access
  const honeypotVars = [
    "__debug_mode__",
    "__admin_panel__",
    "__secret_key__",
    "__backdoor__",
  ];

  honeypotVars.forEach((varName) => {
    let accessCount = 0;
    
    Object.defineProperty(window, varName, {
      get() {
        accessCount++;
        if (accessCount > 1) {
          // Someone is accessing this variable multiple times - likely analyzing code
          console.warn("Suspicious activity detected");
          // Could send alert to server here
        }
        return undefined;
      },
      configurable: false,
    });
  });
}

/**
 * Control flow flattening - make code harder to understand
 */
export function controlFlowFlattening(condition: boolean): number {
  let state = 1;
  let result = 0;

  while (state !== 0) {
    switch (state) {
      case 1:
        if (condition) {
          state = 2;
        } else {
          state = 3;
        }
        break;
      case 2:
        result = 42;
        state = 0;
        break;
      case 3:
        result = 24;
        state = 0;
        break;
    }
  }

  return result;
}

/**
 * Dead code injection - add fake code paths to confuse reverse engineers
 */
export function withDeadCode<T>(fn: () => T): T {
  // Dead code that will never execute
  if (false) {
    const fakeVar = "this will never run";
    console.log(fakeVar);
    // eslint-disable-next-line no-unreachable
    return undefined as T;
  }

  // Another dead code path
  const random = Math.random();
  if (random > 1) {
    // Impossible condition
    const anotherFake = "also never runs";
    console.log(anotherFake);
  }

  // Actual code
  return fn();
}

/**
 * String encryption for sensitive data in code
 */
export class StringEncryption {
  private key: number;

  constructor(key: string) {
    this.key = this.hashString(key);
  }

  encrypt(str: string): string {
    let result = "";
    for (let i = 0; i < str.length; i++) {
      const charCode = str.charCodeAt(i) ^ ((this.key + i) % 256);
      result += String.fromCharCode(charCode);
    }
    return btoa(result);
  }

  decrypt(encrypted: string): string {
    try {
      const decoded = atob(encrypted);
      let result = "";
      for (let i = 0; i < decoded.length; i++) {
        const charCode = decoded.charCodeAt(i) ^ ((this.key + i) % 256);
        result += String.fromCharCode(charCode);
      }
      return result;
    } catch {
      return "";
    }
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}

/**
 * Anti-tampering wrapper for critical functions
 */
export function createTamperProofFunction<T extends (...args: unknown[]) => unknown>(
  fn: T,
  name: string
): T {
  const originalString = fn.toString();
  const checksum = simpleHash(originalString);

  const wrapper = function(this: unknown, ...args: Parameters<T>) {
    // Verify function hasn't been tampered with
    const currentString = fn.toString();
    const currentChecksum = simpleHash(currentString);
    
    if (checksum !== currentChecksum) {
      console.error(`Function ${name} has been tampered with!`);
      throw new Error("Code integrity check failed");
    }

    return fn.apply(this, args);
  } as T;

  return wrapper;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

/**
 * Detect if code is running in a modified environment
 */
export function detectModifiedEnvironment(): boolean {
  if (typeof window === "undefined") return false;

  const checks = [
    // Check if common ad blockers are present (might indicate modified browser)
    () => {
      const adBlockTest = document.createElement("div");
      adBlockTest.innerHTML = "&nbsp;";
      adBlockTest.className = "adsbox";
      document.body.appendChild(adBlockTest);
      const isBlocked = adBlockTest.offsetHeight === 0;
      document.body.removeChild(adBlockTest);
      return isBlocked;
    },
    
    // Check for browser extensions that modify pages
    () => {
      const scripts = document.querySelectorAll("script");
      for (const script of scripts) {
        if (script.src && script.src.includes("extension")) {
          return true;
        }
      }
      return false;
    },
  ];

  return checks.some((check) => {
    try {
      return check();
    } catch {
      return false;
    }
  });
}
