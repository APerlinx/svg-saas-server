declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string
        coins?: number
        plan?: string
      }
    }
  }
}

export {}
