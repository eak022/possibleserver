const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const PromotionSchema = new Schema({
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    promotionName: { type: String, required: true },
    discountedPrice: { type: Number, required: true },
    validityStart: { type: Date, required: true },
    validityEnd: { type: Date, required: true }
  }, { timestamps: true });
  
  
  const PromotionModel = model("Promotion", PromotionSchema);
  module.exports = PromotionModel
  