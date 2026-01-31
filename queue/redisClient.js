// Import Redis client factory
import { createClient } from "redis";

// Import environment configuration
import { config } from "../config/env.js";

// Create a single Redis client instance (singleton)
export const redisClient = createClient({
  // Redis connection URL (redis://host:port) - specifies the Redis server address
  url: config.redisUrl,

  // Socket-level reconnect configuration - configures auto-reconnection behavior
  socket: {
    // Built-in reconnect strategy with exponential backoff - automatically retry on disconnect
    reconnectStrategy: (retries) => {
      // Stop retrying after 5 failed attempts - prevent infinite retry loops
      if (retries > 5) {
        console.error("Redis reconnect failed after 5 retries"); // Log when max retries exceeded
        return new Error("Redis reconnect failed"); // Return error to stop reconnection
      }

      // Retry delay: 1s, 2s, 4s, 8s, 16s (max) - delays increase exponentially
      return Math.min(1000 * 2 ** retries, 16000); // Calculate backoff delay (cap at 16s)
    },
  },
});

// Fired when socket connects - connection to Redis server established
redisClient.on("connect", () => {
  console.log("Redis socket connected"); // Log socket connection event
});

// Fired when Redis is ready to accept commands - client fully initialized
redisClient.on("ready", () => {
  console.log("Redis client ready"); // Log when client is ready for commands
});

// Fired when reconnecting - attempting to restore dropped connection
redisClient.on("reconnecting", () => {
  console.warn("Redis reconnecting..."); // Log reconnection attempt
});

// Fired when connection is fully closed - all connections terminated
redisClient.on("end", () => {
  console.error("Redis connection closed"); // Log connection termination
});

// Fired on any Redis-related error - connection or command errors
redisClient.on("error", (err) => {
  console.error("Redis error:", err); // Log error details for debugging
});

/* -------------------- Initial connection -------------------- */

// Connect Redis only once (safe, idempotent) - check if not already connected
if (!redisClient.isOpen) {
  await redisClient.connect(); // Establish connection to Redis server
  console.log("Redis connected"); // Log successful connection
}
