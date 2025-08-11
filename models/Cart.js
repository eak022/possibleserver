const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const CartSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  image: { type: String, required: true },
  quantity: { type: Number, required: true },
  userName: { type: String, required: true },
  pack: { type: Boolean, required: true },
  // ✅ แยกบรรทัดด้วย barcode (เช่น แพ็ค/ชิ้น หรือโปรโมชัน)
  barcode: { type: String, required: true },
  // ✅ โปรโมชันที่ผูกกับบรรทัดนี้ (ถ้ามี)
  promotionId: { type: Schema.Types.ObjectId, ref: "Promotion" },
  // ✅ เพิ่ม packSize เพื่อแสดงจำนวนชิ้นในแพ็ค
  packSize: { type: Number, default: 1 }
}, { timestamps: true });

// ดัชนีเพื่อให้ค้นรวดเร็วและป้องกันการซ้ำซ้อนเชิงตรรกะต่อผู้ใช้
CartSchema.index({ userName: 1, productId: 1, barcode: 1, promotionId: 1 });

const CartModel = model("Cart", CartSchema);
module.exports = CartModel;