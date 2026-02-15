// Mock BullMQ globally to prevent Redis connection attempts in tests
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
