import pino from 'pino'
import { IS_PRODUCTION } from '../config/env'

export const logger = pino({
  level: IS_PRODUCTION ? 'info' : 'debug',
  transport: IS_PRODUCTION
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
  formatters: {
    level: (label) => {
      return { level: label }
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
})
