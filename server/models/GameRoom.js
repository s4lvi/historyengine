// models/GameRoom.js
import mongoose from "mongoose";

const gameRoomSchema = new mongoose.Schema({
  roomName: { type: String, default: "Game Room" },
  joinCode: { type: String, required: true },
  status: {
    type: String,
    enum: ["open", "ended", "initializing"],
    default: "initializing",
  },
  creator: {
    userId: { type: String, required: true },
    password: { type: String, required: true },
  },
  players: [
    {
      userId: { type: String, required: true },
      password: { type: String, required: true },
    },
  ],
  width: { type: Number, required: true },
  height: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("GameRoom", gameRoomSchema);
