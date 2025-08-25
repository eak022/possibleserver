const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const BlacklistedTokenSchema = new Schema({
  token: { 
    type: String, 
    required: true, 
    unique: true 
  },
  userId: { 
    type: Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  expiresAt: { 
    type: Date, 
    required: true,
    index: { expires: 0 } // TTL index - ลบอัตโนมัติเมื่อหมดอายุ
  }
}, { 
  timestamps: true 
});

const BlacklistedTokenModel = model("BlacklistedToken", BlacklistedTokenSchema);
module.exports = BlacklistedTokenModel;
