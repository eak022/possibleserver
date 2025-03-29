const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const ProductSchema = new Schema({
    productName: { type: String, required: true },
    productDescription: { type: String },
    productImage: { type: String },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    packSize: { type: Number, required: true },
    productStatus: { type: Schema.Types.ObjectId, ref: "Status", required: true },
    barcodePack: { type: String, unique: true },
    barcodeUnit: { type: String, unique: true },
    quantity: { type: Number, required: true },
    purchasePrice: { type: Number, required: true },
    sellingPricePerUnit: {  type: Number, required: true  },
    sellingPricePerPack: {  type: Number, required: true  },
    expirationDate: { type: Date, required: true },
  }, { timestamps: true });
  
  const ProductModel = model("Product", ProductSchema);
  module.exports = ProductModel
  