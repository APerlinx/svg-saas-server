import { Server as SocketIOServer } from 'socket.io'

let io: SocketIOServer | null = null
export const initIO = (instance: SocketIOServer) => (io = instance)
export const tryGetIO = () => io
