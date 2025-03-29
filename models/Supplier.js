const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const SupplierSchema = new Schema({
    companyName: { type: String, required: true },
    sellerName: { type: String, required: true },
    address: { type: String, required: true },
    phoneNumber: { type: String, required: true }
  }, { timestamps: true });
  
  const SupplierModel = model("Supplier", SupplierSchema);
  module.exports = SupplierModel
  