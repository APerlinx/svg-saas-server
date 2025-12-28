"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBullMqConnection = createBullMqConnection;
const ioredis_1 = __importDefault(require("ioredis"));
const env_1 = require("../config/env");
const logger_1 = require("./logger");
/* DOC: createBullMqConnection is a factory that produces dedicated ioredis connections for BullMQ.
   We use this instead of sharing our node-redis cache client because:
   1. BullMQ requires ioredis (it doesn't work with node-redis clients)
   2. Separating concerns—queue operations use different Redis commands (BRPOPLPUSH, etc.) than cache GET/SET
   3. Each BullMQ component (Queue, Worker) needs its own connection to avoid command interleaving
   
   The 'context' param (e.g., "svg-generation-queue" vs "svg-generation-worker") helps us trace logs back to the right component. */
function createBullMqConnection(context) {
    /* DOC: We instantiate a new ioredis client pointing to our shared Upstash Redis instance.
       Same REDIS_URL as the cache, but this is a separate TCP connection. */
    const connection = new ioredis_1.default(env_1.REDIS_URL, {
        /* DOC: maxRetriesPerRequest: null tells ioredis to keep retrying indefinitely for each command.
           BullMQ needs this because it uses blocking commands (BRPOPLPUSH) that can take minutes to resolve.
           Without this, ioredis would timeout and drop the connection mid-block. */
        maxRetriesPerRequest: null,
        /* DOC: enableReadyCheck: false skips the initial INFO command that ioredis usually sends to verify Redis is ready.
           BullMQ's own startup logic handles readiness, so this avoids a redundant round-trip and potential AUTH issues
           if Redis is temporarily unavailable during deployment. */
        enableReadyCheck: false,
    });
    /* DOC: We wire up event listeners so we can track connection lifecycle in logs.
       These fire asynchronously as the connection state changes—useful for debugging Upstash network blips. */
    connection.on('connect', () => 
    /* DOC: 'connect' fires when the TCP handshake completes. At this point we can send commands. */
    logger_1.logger.info({ context }, 'BullMQ Redis connected'));
    connection.on('reconnecting', () => 
    /* DOC: 'reconnecting' means ioredis detected a disconnect (network error, Redis restart) and is attempting to reconnect.
       BullMQ will pause job processing until the connection is restored. */
    logger_1.logger.warn({ context }, 'BullMQ Redis reconnecting'));
    connection.on('error', (error) => {
        /* DOC: 'error' fires for any Redis protocol error or network failure.
           We log it but don't crash—ioredis will keep retrying in the background. */
        logger_1.logger.error({ error, context }, 'BullMQ Redis connection error');
    });
    /* DOC: Return the configured connection so the caller (Queue or Worker) can pass it to BullMQ's constructor.
       Each caller gets its own connection instance to avoid Redis command collisions. */
    return connection;
}
