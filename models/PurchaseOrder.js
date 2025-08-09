const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const PurchaseOrderSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    supplierId: { type: Schema.Types.ObjectId, ref: "Supplier", required: true },
    orderNumber: { type: Number, unique: true, required: true }, // เลขใบสั่งซื้อ
    products: [
      {
        productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
        productName: { type: String, required: true },
        // ข้อมูลการสั่งซื้อ
        orderedQuantity: { type: Number, required: true, default: 1 },
        estimatedPrice: { type: Number, required: true },
        // ข้อมูลการส่งมอบจริง
        deliveredQuantity: { type: Number, default: 0 },
        actualPrice: { type: Number },
        deliveryDate: { type: Date },
        deliveryNotes: { type: String },
        // ข้อมูลอื่นๆ
        sellingPricePerUnit: {  type: Number  },
        expirationDate: {  type: Date },
        subtotal: { type: Number, required: true },
        pack: { type: Boolean, required: true },
        packSize: { type: Number },
      },
    ],
    total: { type: Number, required: true },
    purchaseOrderDate: { type: Date, required: true },
    status: { type: String, enum: ["pending", "delivered", "completed"], default: "pending" }, // เพิ่มสถานะ delivered
    deliveryStatus: { type: String, enum: ["not_delivered", "partially_delivered", "fully_delivered"], default: "not_delivered" }
}, { timestamps: true });

// โมเดลสำหรับเก็บตัวนับเลขใบสั่งซื้อ
const OrderNumberCounterSchema = new Schema({
    counter: { type: Number, default: 1 }
});

const PurchaseOrderModel = model("PurchaseOrder", PurchaseOrderSchema);
const OrderNumberCounterModel = model("OrderNumberCounter", OrderNumberCounterSchema);

module.exports = { PurchaseOrderModel, OrderNumberCounterModel };
