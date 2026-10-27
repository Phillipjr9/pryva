type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

class Logger {
  private level: LogLevel;
  private levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(level: LogLevel = "info") {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levels[level] >= this.levels[this.level];
  }

  private formatEntry(entry: LogEntry): string {
    const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : "";
    return `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${contextStr}`;
  }

  debug(message: string, context?: Record<string, unknown>) {
    if (!this.shouldLog("debug")) return;
    const entry: LogEntry = {
      level: "debug",
      message,
      timestamp: new Date().toISOString(),
      context,
    };
    console.debug(this.formatEntry(entry));
  }

  info(message: string, context?: Record<string, unknown>) {
    if (!this.shouldLog("info")) return;
    const entry: LogEntry = {
      level: "info",
      message,
      timestamp: new Date().toISOString(),
      context,
    };
    console.info(this.formatEntry(entry));
  }

  warn(message: string, context?: Record<string, unknown>) {
    if (!this.shouldLog("warn")) return;
    const entry: LogEntry = {
      level: "warn",
      message,
      timestamp: new Date().toISOString(),
      context,
    };
    console.warn(this.formatEntry(entry));
  }

  error(message: string, context?: Record<string, unknown>) {
    if (!this.shouldLog("error")) return;
    const entry: LogEntry = {
      level: "error",
      message,
      timestamp: new Date().toISOString(),
      context,
    };
    console.error(this.formatEntry(entry));
  }
}

export const logger = new Logger(process.env.NODE_ENV === "development" ? "debug" : "info");

export function createLogger(context: Record<string, unknown>) {
  return {
    debug: (message: string, extra?: Record<string, unknown>) =>
      logger.debug(message, { ...context, ...extra }),
    info: (message: string, extra?: Record<string, unknown>) =>
      logger.info(message, { ...context, ...extra }),
    warn: (message: string, extra?: Record<string, unknown>) =>
      logger.warn(message, { ...context, ...extra }),
    error: (message: string, extra?: Record<string, unknown>) =>
      logger.error(message, { ...context, ...extra }),
  };
}
