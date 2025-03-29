const OrderModel = require("../models/Order");
const CartModel = require("../models/Cart");
const ProductModel = require("../models/Product");

exports.createOrder = async (req, res) => {
  try {
    const { userName, paymentMethod, cash_received } = req.body;

    // ดึงสินค้าจากตะกร้าของผู้ใช้
    const cartItems = await CartModel.find({ userName });
    if (cartItems.length === 0) {
      return res.status(400).json({ message: "Cart is empty" });
    }

    // ตรวจสอบว่าสินค้าในสต็อกเพียงพอหรือไม่
    for (const item of cartItems) {
      const product = await ProductModel.findById(item.productId);
      if (!product) {
        return res.status(404).json({ message: `Product ${item.productName} not found` });
      }

      let requiredQuantity = item.quantity;
      // ถ้า pack เป็น true คูณจำนวนด้วย packSize ก่อน
      if (item.pack) {
        requiredQuantity *= product.packSize;
      }

      // ตรวจสอบจำนวนสินค้าคงเหลือในสต็อก
      if (product.quantity < requiredQuantity) {
        return res.status(400).json({ message: `Not enough stock for ${item.productName}` });
      }
    }

    // คำนวณราคาทั้งหมด
    let subtotal = 0;
    const products = [];
    
    for (const item of cartItems) {
      subtotal += item.price * item.quantity;
      products.push({
        productId: item.productId,
        image: item.image,
        productName: item.name,
        quantity: item.quantity,
        purchasePrice: item.price,
        sellingPricePerUnit: item.price,
        pack:item.pack,
      });

      const product = await ProductModel.findById(item.productId);
      if (!product) {
        return res.status(404).json({ message: `Product ${item.productName} not found` });
      }

      let requiredQuantity = item.quantity;
      // ถ้า pack เป็น true คูณจำนวนด้วย packSize ก่อน
      if (item.pack ) {
        requiredQuantity *= product.packSize;
      }

      // ตัดสต็อกสินค้า
      await ProductModel.findByIdAndUpdate(item.productId, {
        $inc: { quantity: -requiredQuantity },
      });
    }

    const total = subtotal;
    let change = 0;

    if (paymentMethod === "Cash") {
      if (cash_received < total) {
        return res.status(400).json({ message: "Cash received is not enough" });
      }
      change = cash_received - total;
    }

    // บันทึกคำสั่งซื้อ
    const newOrder = new OrderModel({
      userName,
      products,
      subtotal,
      total,
      paymentMethod,
      cash_received: paymentMethod === "Cash" ? cash_received : 0,
      change,
      orderDate: new Date(),
    });

    await newOrder.save();

    // ล้างตะกร้าหลังจากสั่งซื้อ
    await CartModel.deleteMany({ userName });

    res.status(201).json({ message: "Order created successfully", order: newOrder });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.getOrders = async (req, res) => {
  try {
    const orders = await OrderModel.find().sort({ createdAt: -1 });
    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving orders", error });
  }
};

exports.getOrderById = async (req, res) => {
  try {
    const order = await OrderModel.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    res.status(200).json(order);
  } catch (error) {
    res.status(500).json({ message: "Error retrieving order", error });
  }
};

exports.deleteOrder = async (req, res) => {
  try {
    const order = await OrderModel.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // คืนสต็อกสินค้า
    for (const item of order.products) {
      await ProductModel.findByIdAndUpdate(item.productId, {
        $inc: { quantity: item.quantity }
      });
    }

    // ลบคำสั่งซื้อ
    await OrderModel.findByIdAndDelete(req.params.id);

    res.status(200).json({ message: "Order deleted and stock updated" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting order", error });
  }
};
exports.updateOrderDetail = async (req, res) => {
  try {
    const { productId, quantity, sellingPricePerUnit, pack } = req.body;

    const order = await OrderModel.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (productId) {
      const product = await ProductModel.findById(productId);
      if (!product) {
        return res.status(404).json({ message: `Product not found` });
      }

      const oldItem = order.products.find(p => p.productId.toString() === productId.toString());
      if (!oldItem) {
        return res.status(404).json({ message: `Product not found in this order` });
      }

      // 🔴 ห้ามเปลี่ยน pack (ใช้ค่าเดิมเสมอ)
      const previousPack = oldItem.pack;

      let newQuantity = quantity !== undefined ? quantity : oldItem.quantity;

      let oldTotalQuantity = previousPack ? oldItem.quantity * product.packSize : oldItem.quantity;
      let newTotalQuantity = previousPack ? newQuantity * product.packSize : newQuantity;
      let quantityDiff = newTotalQuantity - oldTotalQuantity;

      // ถ้าสต็อกไม่พอ
      if (quantityDiff > 0 && product.quantity < quantityDiff) {
        return res.status(400).json({ message: `Not enough stock for ${product.productName}` });
      }

      // ปรับสต็อกสินค้า
      await ProductModel.findByIdAndUpdate(productId, {
        $inc: { quantity: -quantityDiff }
      });

      // อัปเดตข้อมูลสินค้า (แต่ห้ามแก้ pack)
      oldItem.quantity = newQuantity;
      oldItem.sellingPricePerUnit = sellingPricePerUnit || oldItem.sellingPricePerUnit;

      let subtotal = 0;
      order.products.forEach(item => {
        subtotal += item.sellingPricePerUnit * item.quantity;
      });

      order.subtotal = subtotal;
      order.total = subtotal;

      await order.save();

      return res.status(200).json({ message: "Order updated and stock adjusted", order });
    }

    res.status(400).json({ message: "No valid update parameters provided" });
  } catch (error) {
    console.error("Error updating order:", error);
    res.status(500).json({ message: "Error updating order", error });
  }
};
