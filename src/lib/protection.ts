/**
 * Application Protection Hook
 * Actively monitors for reverse engineering attempts and suspicious behavior
 */

import { useEffect, useRef } from "react";
import {
  detectDevTools,
  detectDebugger,
  detectCodeInjection,
  detectIframe,
  detectScraping,
  createHoneypot,
  detectModifiedEnvironment,
} from "./anti-reverse-engineering";

interface ProtectionConfig {
  enableDevToolsDetection?: boolean;
  enableDebuggerDetection?: boolean;
  enableInjectionDetection?: boolean;
  enableIframeDetection?: boolean;
  enableScrapingDetection?: boolean;
  enableHoneypot?: boolean;
  onViolation?: (type: string, details: string) => void;
}

/**
 * React hook to protect against reverse engineering
 */
export function useProtection(config: ProtectionConfig = {}) {
  const {
    enableDevToolsDetection = true,
    enableDebuggerDetection = process.env.NODE_ENV === "production",
    enableInjectionDetection = true,
    enableIframeDetection = true,
    enableScrapingDetection = true,
    enableHoneypot = true,
    onViolation,
  } = config;

  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Setup honeypot on mount
    if (enableHoneypot) {
      createHoneypot();
    }

    // Continuous monitoring
    const checkInterval = setInterval(() => {
      const violations: string[] = [];

      // DevTools detection
      if (enableDevToolsDetection && detectDevTools()) {
        violations.push("DevTools detected");
        onViolation?.("devtools", "Browser DevTools are open");
      }

      // Debugger detection (only in production)
      if (enableDebuggerDetection && detectDebugger()) {
        violations.push("Debugger attached");
        onViolation?.("debugger", "Debugger is attached to the application");
      }

      // Code injection detection
      if (enableInjectionDetection && detectCodeInjection()) {
        violations.push("Code injection detected");
        onViolation?.("injection", "Suspicious code injection attempt");
      }

      // Iframe detection (clickjacking protection)
      if (enableIframeDetection && detectIframe()) {
        violations.push("Running in iframe");
        onViolation?.("iframe", "Application is running in an iframe");
      }

      // Scraping detection
      if (enableScrapingDetection) {
        const scrapingResult = detectScraping();
        if (scrapingResult.isScraping) {
          violations.push(`Scraping detected: ${scrapingResult.signals.join(", ")}`);
          onViolation?.("scraping", scrapingResult.signals.join(", "));
        }
      }

      // Modified environment detection
      if (detectModifiedEnvironment()) {
        violations.push("Modified environment detected");
        onViolation?.("modified", "Running in a modified browser environment");
      }

      // Handle violations
      if (violations.length > 0) {
        console.warn("🛡️ Protection violations detected:", violations);
        
        // In production, you might want to:
        // 1. Send alerts to your monitoring system
        // 2. Degrade functionality
        // 3. Show warnings to users
        // 4. Block certain actions
        
        if (process.env.NODE_ENV === "production") {
          // Send to monitoring service
          reportViolations(violations);
        }
      }
    }, 2000); // Check every 2 seconds

    intervalRef.current = checkInterval;

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [
    enableDevToolsDetection,
    enableDebuggerDetection,
    enableInjectionDetection,
    enableIframeDetection,
    enableScrapingDetection,
    enableHoneypot,
    onViolation,
  ]);
}

/**
 * Report violations to monitoring service
 */
async function reportViolations(violations: string[]) {
  try {
    await fetch("/api/security/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        violations,
        timestamp: new Date().toISOString(),
        url: window.location.href,
        userAgent: navigator.userAgent,
      }),
    });
  } catch (error) {
    // Silently fail - don't expose monitoring
    console.error("Failed to report violations");
  }
}

/**
 * Protection wrapper for sensitive operations
 */
export function withProtection<T extends (...args: unknown[]) => unknown>(
  fn: T,
  options: {
    requireSecureContext?: boolean;
    maxExecutionTime?: number;
  } = {}
): T {
  const { requireSecureContext = true, maxExecutionTime = 5000 } = options;

  return ((...args: Parameters<T>) => {
    // Check context
    if (requireSecureContext) {
      if (detectDevTools()) {
        throw new Error("Operation blocked: DevTools detected");
      }
      
      if (detectCodeInjection()) {
        throw new Error("Operation blocked: Code tampering detected");
      }
    }

    // Execute with timeout protection
    const startTime = Date.now();
    const result = fn(...args);
    const executionTime = Date.now() - startTime;

    if (executionTime > maxExecutionTime) {
      console.warn(`Operation took ${executionTime}ms, which is unusually long`);
    }

    return result;
  }) as T;
}
