import mongoose from "mongoose";

const scheduleSchema = new mongoose.Schema({
  trainId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Train",
    required: true
  },

  departureDate: {
    type: Date,
    required: true
  },

  status: {
    type: String,
    enum: ["ACTIVE", "CANCELLED"],
    default: "ACTIVE"
  }

}, { timestamps: true });

scheduleSchema.index({ trainId: 1, departureDate: 1 }, { unique: true });

scheduleSchema.index({ trainId: 1 });

// scheduleSchema.pre("save", function (next) {
//   if (this.departureDate) {
//     this.departureDate.setHours(0, 0, 0, 0);
//   }
//   next();
// });

scheduleSchema.pre("save", async function () {
  if (this.departureDate) {
    this.departureDate.setHours(0, 0, 0, 0);
  }
});

scheduleSchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate();

  if (update.departureDate) {
    update.departureDate = new Date(update.departureDate);
    update.departureDate.setHours(0, 0, 0, 0);
  }

  next();
});

export const Schedule = mongoose.model("Schedule", scheduleSchema);

