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
      if (product.quantity < item.quantity) {
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
      });

      // ตัดสต็อกสินค้า
      await ProductModel.findByIdAndUpdate(item.productId, {
        $inc: { quantity: -item.quantity },
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
    const { products } = req.body;

    // ตรวจสอบว่า products เป็น array
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: "Products data is required and must be an array." });
    }

    const order = await OrderModel.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // คืนสต็อกสินค้าจากออเดอร์เก่า
    for (const oldItem of order.products) {
      await ProductModel.findByIdAndUpdate(oldItem.productId, {
        $inc: { quantity: oldItem.quantity }
      });
    }

    let subtotal = 0;
    const updatedProducts = [];

    // ตรวจสอบสินค้าใหม่และอัปเดตสต็อก
    for (const newItem of products) {
      const product = await ProductModel.findById(newItem.productId);
      if (!product) {
        return res.status(404).json({ message: `Product ${newItem.productName} not found` });
      }

      // ตรวจสอบสินค้าที่มีในออเดอร์เก่า
      const oldItem = order.products.find(p => p.productId.toString() === newItem.productId.toString());
      let quantityDiff = 0;
      if (oldItem) {
        // คำนวณความแตกต่างของจำนวนสินค้า
        quantityDiff = newItem.quantity - oldItem.quantity;
      } else {
        quantityDiff = newItem.quantity;
      }

      // เช็กว่าเพียงพอไหมกับจำนวนที่ต้องการ
      if (product.quantity < quantityDiff) {
        return res.status(400).json({ message: `Not enough stock for ${newItem.productName}` });
      }

      // ปรับจำนวนสต็อกให้ถูกต้อง
      await ProductModel.findByIdAndUpdate(newItem.productId, {
        $inc: { quantity: -quantityDiff } // ลดจำนวนสินค้าตามจำนวนที่ต้องการ
      });

      subtotal += newItem.sellingPricePerUnit * newItem.quantity;
      updatedProducts.push(newItem);
    }

    const total = subtotal;

    // อัปเดตคำสั่งซื้อ
    order.products = updatedProducts;
    order.subtotal = subtotal;
    order.total = total;
    await order.save();

    res.status(200).json({ message: "Order updated and stock adjusted", order });
  } catch (error) {
    console.error("Error updating order:", error);
    res.status(500).json({ message: "Error updating order", error });
  }
};
