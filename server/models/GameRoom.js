// models/GameRoom.js
import mongoose from "mongoose";

const gameRoomSchema = new mongoose.Schema({
  map: { type: mongoose.Schema.Types.ObjectId, ref: "Map", required: true },
  roomName: { type: String, default: "Game Room" },
  joinCode: { type: String, required: true },
  status: {
    type: String,
    enum: ["open", "ended", "initializing", "paused", "error"],
    default: "open",
  },
  creator: {
    userId: { type: String, required: true },
    password: { type: String, default: null },
    profile: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  players: [
    {
      userId: { type: String, required: true },
      password: { type: String, default: null },
      profile: { type: mongoose.Schema.Types.Mixed, default: {} },
      userState: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
  ],
  gameState: { type: mongoose.Schema.Types.Mixed, default: {} },
  matrixState: { type: mongoose.Schema.Types.Mixed, default: null },
  discordInstanceId: { type: String, default: null },
  tickCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

gameRoomSchema.index({ discordInstanceId: 1 }, { sparse: true });

// Register and export the model.
export default mongoose.model("GameRoom", gameRoomSchema);
