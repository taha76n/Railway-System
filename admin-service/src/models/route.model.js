import mongoose from "mongoose";

const routeSchema = new mongoose.Schema(
  {
    trainId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Train",
      required: true,
      unique: true   
    }
  },
  { timestamps: true }
);

// optional (same as above, cleaner in large apps)
// routeSchema.index({ trainId: 1 }, { unique: true });

export const Route = mongoose.model("Route", routeSchema);