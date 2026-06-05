import mongoose from "mongoose";

const authProviderSchema = new mongoose.Schema({
  provider: {
    type: String,
    required: true,
    enum: ["google"]
  },
  providerId: {
    type: String,
    required: true,
  },
  UserId:{
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  }
}, {timestamps: true})

/* ONE GOOGLE ACCOUNT -> ONE USER */
authProviderSchema.index({provider: 1, providerId: 1}, {unique: true});

/* ONE USER -> ONE GOOGLE ACCOUNT */
authProviderSchema.index({UserId: 1, provider: 1}, {unique: true});

/* INDEX for quick lookup */
authProviderSchema.index({UserId: 1});

export const AuthProvider = mongoose.model("AuthProvider", authProviderSchema);
