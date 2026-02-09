// models/User.js
import mongoose from "mongoose";

const providerSchema = new mongoose.Schema(
  {
    sub: { type: String, required: true },
    email: { type: String },
    name: { type: String },
    picture: { type: String },
  },
  { _id: false }
);

const profileSchema = new mongoose.Schema(
  {
    displayName: { type: String },
    nationName: { type: String },
    capitalName: { type: String },
    color: { type: String },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    providers: {
      google: { type: providerSchema },
      discord: { type: providerSchema },
    },
    profile: { type: profileSchema, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
