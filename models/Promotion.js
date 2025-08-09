const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const PromotionSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
  promotionName: { type: String, required: true },
  discountedPrice: { type: Number, required: true },
  validityStart: { type: Date, required: true },
  validityEnd: { type: Date, required: true },
  // ✅ เลือกล็อตที่จะเข้าร่วมโปรได้หลายล็อต (เก็บเป็น lotNumber ของสินค้านั้น)
  appliedLots: [{ type: String }],
  // ✅ บาร์โค้ดของโปรโมชัน (สร้างอัตโนมัติที่ฝั่งเซิร์ฟเวอร์)
  barcode: { type: String, unique: true, required: true }
}, { timestamps: true });

const PromotionModel = model("Promotion", PromotionSchema);
module.exports = PromotionModel
  