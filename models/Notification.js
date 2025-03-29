const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const NotificationSchema = new Schema({
    productId: { type: Number, required: true },
    notificationType: { type: String, enum: ["LOW_STOCK", "EXPIRY"], required: true },
    notificationDate: { type: Date, required: true }
  }, { timestamps: true });
  

  const NotificationModel = model("Notification", NotificationSchema);
  module.exports = NotificationModel
  
  
  