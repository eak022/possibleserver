const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const CartSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: "Product", require: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  image: { type: String, required: true },
  quantity: { type: Number, required: true },
  userName: { type: String, required: true },
  pack: { type: Boolean, required: true },
});

const CartModel = model("Cart", CartSchema);
module.exports = CartModel;