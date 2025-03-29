const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const PurchaseOrderSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    supplierId: { type: Schema.Types.ObjectId, ref: "Supplier", required: true },
    products: [
      {
        productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
        productName: { type: String, required: true },
        quantity: { type: Number, required: true, default: 1 },
        purchasePrice: { type: Number, required: true },
        sellingPricePerUnit: {  type: Number, required: true  },
        expirationDate: {  type: Date, required: true  },
        subtotal: { type: Number, required: true },
      },
    ],
    total: { type: Number, required: true },
    purchaseOrderDate: { type: Date, required: true },
    status: { type: String, enum: ["pending", "completed"], default: "pending" } // ✅ ป้องกันเติมซ้ำ
}, { timestamps: true });

const PurchaseOrderModel = model("PurchaseOrder", PurchaseOrderSchema);
module.exports = PurchaseOrderModel;
