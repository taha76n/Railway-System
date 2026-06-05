import mongoose from "mongoose";

const trainSchema = new mongoose.Schema(
  {
    trainNumber: {
      type: String,
      unique: true,
      required: true,
    },
    trainName: {
      type: String,
      required: true,
    },
    coachName: {
      type: String,
      default: "AC",
    },
    
  },
  { timestamps: true }
);

trainSchema.pre("findOneAndDelete", async function (next) {
  const train = await this.model.findOne(this.getFilter());

  if (train) {
    await mongoose.model("Seat").deleteMany({ trainId: train._id });
    await mongoose.model("Schedule").deleteMany({ trainId: train._id });
    await mongoose.model("Route").deleteOne({ trainId: train._id });
  }

  next();
});

export const Train = mongoose.model("Train", trainSchema);
