const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const OrderSchema = new Schema({
  userName: { type: String, required: true},
  products: [
    {
      productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
      image: { type: String, required: true },
      productName: { type: String, required: true },
      quantity: { type: Number, required: true, default: 1 },
      purchasePrice: { type: Number, required: true }, // ราคาทุนเฉลี่ย ณ เวลาขาย
      sellingPricePerUnit: {  type: Number, required: true  }, // ราคาขาย ณ เวลาขาย
      pack: { type: Boolean, required: true },
      packSize: { type: Number },
      // ✅ ข้อมูลล็อตที่ใช้ในการขาย
      lotsUsed: [{
        lotNumber: { type: String, required: true },
        quantityTaken: { type: Number, required: true }, // จำนวนที่ใช้จากล็อตนี้
        purchasePrice: { type: Number, required: true }, // ราคาซื้อของล็อตนี้
        expirationDate: { type: Date, required: false } // วันหมดอายุของล็อตนี้ (ไม่บังคับ)
      }],
      // ✅ ข้อมูลเพิ่มเติม
      originalPrice: { type: Number }, // ราคาเดิมก่อนโปรโมชั่น
      discountAmount: { type: Number, default: 0 }, // ส่วนลด
    },
  ],
  subtotal: { type: Number, required: true },
  total: { type: Number, required: true },
  promotionId: [
    {
      productId: { type: Schema.Types.ObjectId, ref: "Promotion", required: true },
      promotionName: { type: String, required: true },
      discountedPrice: { type: Number, required: true },
    },
  ],
  paymentMethod: {
    type: String,
    required: true,
    enum: ["Cash", "BankTransfer", "ตัดจำหน่าย"],
  },
  cash_received: { type: Number, default: 0 },
  change: { type: Number, default: 0 },
  orderDate: { type: Date, required: true },
  orderStatus: { 
    type: String, 
    required: true,
    enum: ["ขายสำเร็จ", "ยกเลิก", "คืนสินค้า", "ตัดจำหน่าย"],
    default: "ขายสำเร็จ"
  }
}, { timestamps: true });

const OrderModel = model("Order", OrderSchema);
module.exports = OrderModel


