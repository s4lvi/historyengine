import mongoose from "mongoose";

const gameRoomSchema = new mongoose.Schema({
  roomName: { type: String, default: "Game Room" },
  joinCode: { type: String, required: true },
  status: {
    type: String,
    enum: ["lobby", "in-progress", "ended"],
    default: "lobby",
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
  // New lobby settings object
  lobby: {
    // Map configuration that the lobby creator can adjust before starting the game
    mapSize: {
      type: String,
      enum: ["Small", "Normal", "Large"],
      default: "Normal",
    },
    width: { type: Number, default: 150 },
    height: { type: Number, default: 150 },
    erosion_passes: { type: Number, default: 3 },
    num_blobs: { type: Number, default: 9 },
    // Maximum number of players allowed in the lobby
    maxPlayers: { type: Number, default: 4 },
  },
  // Other fields (such as game map data) can be added later when transitioning from lobby to game.
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("GameRoom", gameRoomSchema);
