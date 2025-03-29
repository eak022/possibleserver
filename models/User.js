const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const UserSchema = new Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phoneNumber: { type: String, default: null },
  address: { type: String, default: null },
  shopName: { type: String, default: null }
}, { timestamps: true });

const UserModel = model("User", UserSchema);
module.exports = UserModel

