// models/GameRoom.js
import mongoose from "mongoose";

const gameRoomSchema = new mongoose.Schema({
  map: { type: mongoose.Schema.Types.ObjectId, ref: "Map", required: true },
  roomName: { type: String, default: "Game Room" },
  joinCode: { type: String, required: true },
  status: {
    type: String,
    enum: ["open", "ended", "initializing"],
    default: "open",
  },
  creator: {
    userId: { type: String, required: true },
    password: { type: String, required: true },
  },
  players: [
    {
      userId: { type: String, required: true },
      password: { type: String, required: true },
      userState: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
  ],
  gameState: { type: mongoose.Schema.Types.Mixed, default: {} },
  tickCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

// Register and export the model.
export default mongoose.model("GameRoom", gameRoomSchema);
