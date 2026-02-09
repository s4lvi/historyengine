import { WebSocketServer } from "ws";
import GameRoom from "./models/GameRoom.js";
import { buildGameStateResponse } from "./utils/gameStateView.js";

const rooms = new Map(); // roomId -> Set<ws>
let wss = null;
const lastActivity = new Map(); // roomId -> timestamp

function addToRoom(ws, roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  rooms.get(roomId).add(ws);
}

function removeFromRoom(ws) {
  if (!ws.roomId) return;
  const set = rooms.get(ws.roomId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) rooms.delete(ws.roomId);
}

function safeSend(ws, payload) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

export function touchRoom(roomId) {
  lastActivity.set(roomId, Date.now());
}

export function getLastActivity(roomId) {
  return lastActivity.get(roomId) || 0;
}

export function hasActiveConnections(roomId) {
  const set = rooms.get(roomId);
  return !!(set && set.size > 0);
}

let getLiveRoomFn = null;

export function initWebSocket(server, getLiveRoom) {
  if (wss) return wss;
  getLiveRoomFn = getLiveRoom || null;
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    console.log(`[WS] Connection from ${req.socket.remoteAddress}`);
    ws.isAlive = true;

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", async (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch (err) {
        safeSend(ws, { type: "error", message: "Invalid JSON payload" });
        return;
      }

      if (msg.type === "subscribe") {
        const { roomId, userId, password, full } = msg;
        console.log(`[WS] Subscribe attempt room=${roomId} user=${userId}`);
        if (!roomId || !userId || !password) {
          safeSend(ws, {
            type: "error",
            message: "roomId, userId, and password are required",
          });
          return;
        }

        // Try in-memory live room first, fall back to DB
        let gameRoom = getLiveRoomFn ? await getLiveRoomFn(roomId) : null;
        if (!gameRoom) {
          gameRoom = await GameRoom.findById(roomId).lean();
        }
        if (!gameRoom) {
          console.warn(`[WS] Subscribe failed: room not found ${roomId}`);
          safeSend(ws, { type: "error", message: "Game room not found" });
          return;
        }

        const player = gameRoom.players?.find(
          (p) => p.userId === userId && p.password === password
        );
        if (!player) {
          console.warn(`[WS] Subscribe failed: invalid credentials for ${userId}`);
          safeSend(ws, { type: "error", message: "Invalid credentials" });
          return;
        }

        ws.roomId = roomId;
        ws.userId = userId;
        ws.full = !!full;
        addToRoom(ws, roomId);
        touchRoom(roomId);

        safeSend(ws, { type: "subscribed", roomId, full: ws.full });
        safeSend(ws, {
          type: "state",
          ...buildGameStateResponse(gameRoom, userId, ws.full),
        });
        return;
      }

      if (msg.type === "unsubscribe") {
        removeFromRoom(ws);
        ws.roomId = null;
        ws.userId = null;
        ws.full = false;
        safeSend(ws, { type: "unsubscribed" });
      }
    });

    ws.on("close", (code, reason) => {
      console.log(
        `[WS] Closed ${ws.roomId || "unsubscribed"} code=${code} reason=${reason?.toString?.() || ""}`
      );
      removeFromRoom(ws);
    });
    ws.on("error", (err) => {
      console.warn(`[WS] Error: ${err?.message || err}`);
    });
  });

  const interval = setInterval(() => {
    if (!wss) return;
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        removeFromRoom(ws);
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("close", () => clearInterval(interval));

  return wss;
}

export function broadcastRoomUpdate(roomId, gameRoom, matrix = null) {
  const set = rooms.get(roomId);
  if (!set || set.size === 0) {
    if (process.env.DEBUG_WS === "true") {
      console.log(`[WS] No clients for room ${roomId}`);
    }
    return;
  }
  let sentCount = 0;
  set.forEach((ws) => {
    if (!ws.userId) return;
    safeSend(ws, {
      type: "state",
      ...buildGameStateResponse(gameRoom, ws.userId, ws.full, matrix),
    });
    sentCount++;
  });
  if (process.env.DEBUG_WS === "true") {
    console.log(`[WS] Broadcast to ${sentCount} clients in room ${roomId} (tick ${gameRoom.tickCount})`);
  }
}
