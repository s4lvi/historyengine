import { WebSocketServer } from "ws";
import GameRoom from "./models/GameRoom.js";
import { buildGameStateResponse } from "./utils/gameStateView.js";
import { getSessionUserIdFromRequest } from "./utils/auth.js";

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
    ws.send(typeof payload === "string" ? payload : JSON.stringify(payload));
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
let getMatrixFn = null;

export function initWebSocket(server, getLiveRoom, getMatrix) {
  if (wss) return wss;
  getLiveRoomFn = getLiveRoom || null;
  getMatrixFn = getMatrix || null;
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    console.log(`[WS] Connection from ${req.socket.remoteAddress}`);
    ws.isAlive = true;
    ws.sessionUserId = getSessionUserIdFromRequest(req);

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
        const { roomId, full } = msg;
        const userId = ws.sessionUserId;
        console.log(`[WS] Subscribe attempt room=${roomId} user=${userId}`);
        if (!roomId || !userId) {
          safeSend(ws, {
            type: "error",
            message: "roomId and authenticated session are required",
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

        const player = gameRoom.players?.find((p) => p.userId === userId);
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
        const matrix = getMatrixFn ? getMatrixFn(roomId) : null;
        safeSend(ws, {
          type: "state",
          ...buildGameStateResponse(gameRoom, userId, ws.full, matrix),
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
      removeFromRoom(ws);
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

  // Group clients by type: owners (need per-user response) vs spectators (share enemy view)
  const ownerClients = []; // clients that own a nation (need unique troop density data)
  const enemyClients = []; // clients that don't own a nation (share identical response)
  set.forEach((ws) => {
    if (!ws.userId) return;
    const isOwner = (gameRoom.gameState?.nations || []).some(
      (n) => n.owner === ws.userId && n.status !== "defeated"
    );
    if (isOwner) {
      ownerClients.push(ws);
    } else {
      enemyClients.push(ws);
    }
  });

  // Build and cache enemy (non-owner) response JSON once for all spectators
  let cachedEnemyJson = null;
  if (enemyClients.length > 0) {
    // Use a dummy userId that won't match any nation
    const enemyResponse = buildGameStateResponse(gameRoom, "__spectator__", false, matrix);
    cachedEnemyJson = JSON.stringify({ type: "state", ...enemyResponse });
    for (const ws of enemyClients) {
      safeSend(ws, cachedEnemyJson);
    }
  }

  // Owner clients still need per-user responses (troop density data is per-nation)
  for (const ws of ownerClients) {
    safeSend(ws, {
      type: "state",
      ...buildGameStateResponse(gameRoom, ws.userId, ws.full, matrix),
    });
  }

  if (process.env.DEBUG_WS === "true") {
    console.log(`[WS] Broadcast to ${ownerClients.length} owners + ${enemyClients.length} spectators in room ${roomId} (tick ${gameRoom.tickCount})`);
  }
}
