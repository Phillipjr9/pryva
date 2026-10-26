export const SERVICE_TIMEOUTS = {
  numbers: {
    delivery: 20 * 60 * 1000, // 20 minutes
    retryAttempts: 3,
    retryDelay: 60 * 1000, // 1 minute
  },
  esim: {
    delivery: 5 * 60 * 1000, // 5 minutes
    retryAttempts: 2,
    retryDelay: 30 * 1000, // 30 seconds
  },
  proxies: {
    delivery: 2 * 60 * 1000, // 2 minutes
    retryAttempts: 2,
    retryDelay: 30 * 1000,
  },
  "email-otp": {
    delivery: 5 * 60 * 1000, // 5 minutes
    retryAttempts: 3,
    retryDelay: 60 * 1000,
  },
  data: {
    delivery: 2 * 60 * 1000, // 2 minutes
    retryAttempts: 2,
    retryDelay: 30 * 1000,
  },
  "gift-cards": {
    delivery: 60 * 1000, // 1 minute
    retryAttempts: 1,
    retryDelay: 10 * 1000,
  },
  bulk: {
    delivery: 10 * 60 * 1000, // 10 minutes
    retryAttempts: 2,
    retryDelay: 60 * 1000,
  },
  scheduled: {
    delivery: 5 * 60 * 1000, // 5 minutes
    retryAttempts: 3,
    retryDelay: 60 * 1000,
  },
};

export type ServiceType = keyof typeof SERVICE_TIMEOUTS;

export function getServiceTimeout(service: string): typeof SERVICE_TIMEOUTS.numbers {
  const timeout = SERVICE_TIMEOUTS[service as ServiceType];
  if (!timeout) {
    throw new Error(`Unknown service type: ${service}`);
  }
  return timeout;
}

export function isEligibleForRetry(
  retryCount: number,
  lastRetryAt: Date | null,
  serviceType: string
): boolean {
  const config = getServiceTimeout(serviceType);
  
  if (retryCount >= config.retryAttempts) {
    return false;
  }

  if (!lastRetryAt) {
    return true;
  }

  const timeSinceLastRetry = Date.now() - lastRetryAt.getTime();
  return timeSinceLastRetry >= config.retryDelay;
}

export function getTimeUntilTimeout(createdAt: Date, serviceType: string): number {
  const config = getServiceTimeout(serviceType);
  const elapsed = Date.now() - createdAt.getTime();
  const remaining = config.delivery - elapsed;
  return Math.max(0, remaining);
}

export function isTimedOut(createdAt: Date, serviceType: string): boolean {
  return getTimeUntilTimeout(createdAt, serviceType) === 0;
}

export function formatTimeout(ms: number): string {
  if (ms <= 0) return "Expired";
  
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
