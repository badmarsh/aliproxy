type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function formatMessage(
  level: LogLevel,
  component: string,
  message: string,
  data?: Record<string, unknown>,
): string {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    message,
    ...data,
  };
  return JSON.stringify(entry);
}

export function createLogger(component: string) {
  return {
    debug(message: string, data?: Record<string, unknown>) {
      if (shouldLog("debug")) {
        process.stdout.write(formatMessage("debug", component, message, data) + "\n");
      }
    },
    info(message: string, data?: Record<string, unknown>) {
      if (shouldLog("info")) {
        process.stdout.write(formatMessage("info", component, message, data) + "\n");
      }
    },
    warn(message: string, data?: Record<string, unknown>) {
      if (shouldLog("warn")) {
        process.stderr.write(formatMessage("warn", component, message, data) + "\n");
      }
    },
    error(message: string, data?: Record<string, unknown>) {
      if (shouldLog("error")) {
        process.stderr.write(formatMessage("error", component, message, data) + "\n");
      }
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
