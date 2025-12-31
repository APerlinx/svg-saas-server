import os from 'os'

export const INSTANCE_ID =
  process.env.INSTANCE_ID ?? `${os.hostname()}-${process.pid}`
