// Mock BullMQ package to prevent Redis connection attempts in tests
jest.mock('bullmq', () => {
  const EventEmitter = require('events')
  
  class MockQueue extends EventEmitter {
    constructor() {
      super()
      this.add = jest.fn()
      this.getJobCounts = jest.fn().mockResolvedValue({ waiting: 0, active: 0, delayed: 0 })
      this.close = jest.fn()
    }
  }
  
  class MockQueueEvents extends EventEmitter {
    constructor() {
      super()
      this.close = jest.fn()
    }
  }
  
  class MockWorker extends EventEmitter {
    constructor() {
      super()
      this.close = jest.fn()
    }
  }
  
  return {
    Queue: MockQueue,
    QueueEvents: MockQueueEvents,
    Worker: MockWorker,
    UnrecoverableError: class UnrecoverableError extends Error {},
  }
})

// Mock our BullMQ connection wrapper
jest.mock('./src/lib/bullmq', () => ({
  createBullMqConnection: jest.fn(() => ({
    on: jest.fn(),
    quit: jest.fn(),
    disconnect: jest.fn(),
  })),
}))

// Mock Redis client globally
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    on: jest.fn(),
    connect: jest.fn(),
    quit: jest.fn(),
    disconnect: jest.fn(),
  })),
}))
