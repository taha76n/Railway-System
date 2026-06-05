import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  firstName:{
    type: String,
    required: true,
  },
  lastName:{
    type: String,
    required: true,
  },
  email:{
    type: String,
    required: true,
    unique: true,
  },
  password:{
    type: String,
  },
  emailVerified:{
    type: Boolean,
    default: false,
  },
},{timestamps: true})


export const User = mongoose.model("User", userSchema);

