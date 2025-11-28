import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname',
          singleLine: false
        }
      }
    : undefined,
  timestamp: () => `,"time":"${new Date().toLocaleString('en-US', { timeZone: 'Asia/Saigon' })}"`
});

// Child loggers for different modules
export const authLogger = logger.child({ module: 'auth' });
export const cacheLogger = logger.child({ module: 'cache' });
export const apiLogger = logger.child({ module: 'api' });
export const cronLogger = logger.child({ module: 'cron' });
