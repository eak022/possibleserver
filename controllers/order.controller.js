const OrderModel = require("../models/Order");
const CartModel = require("../models/Cart");
const ProductModel = require("../models/Product");
const PromotionModel = require("../models/Promotion");
const { checkAndAddStock } = require("./purchaseOrder.controller");

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

    // คำนวณราคาทั้งหมดและโปรโมชั่น
    let subtotal = 0;
    let totalDiscount = 0;
    const products = [];
    const appliedPromotions = [];
    
    for (const item of cartItems) {
      const product = await ProductModel.findById(item.productId);
      if (!product) {
        return res.status(404).json({ message: `Product ${item.productName} not found` });
      }

      let requiredQuantity = item.quantity;
      if (item.pack) {
        requiredQuantity *= product.packSize;
      }

      // ใช้ราคาทุนจาก ProductModel
      const purchasePrice = item.pack 
        ? product.purchasePrice * product.packSize  // ถ้าเป็นแพ็ค คูณ packSize
        : product.purchasePrice; // ถ้าเป็นหน่วยเดียว ใช้ราคาปกติ

      // ตรวจสอบโปรโมชั่นที่ใช้งานได้
      const currentDate = new Date();
      const activePromotion = await PromotionModel.findOne({
        productId: item.productId,
        validityStart: { $lte: currentDate },
        validityEnd: { $gte: currentDate }
      });

      let finalPrice = item.price;
      let itemDiscount = 0;

      if (activePromotion) {
        // ใช้ราคาโปรโมชั่น
        finalPrice = activePromotion.discountedPrice;
        itemDiscount = (item.price - activePromotion.discountedPrice) * item.quantity;
        totalDiscount += itemDiscount;

        // บันทึกโปรโมชั่นที่ใช้
        appliedPromotions.push({
          productId: activePromotion._id,
          promotionName: activePromotion.promotionName,
          discountedPrice: activePromotion.discountedPrice,
          originalPrice: item.price,
          discountAmount: itemDiscount
        });
      }

      subtotal += finalPrice * item.quantity;
      products.push({
        productId: item.productId,
        image: item.image,
        productName: item.name,
        quantity: item.quantity,
        purchasePrice: purchasePrice,
        sellingPricePerUnit: finalPrice,
        pack: item.pack,
        originalPrice: item.price,
        discountAmount: itemDiscount,
        packSize: product.packSize
      });

      // ตัดสต็อกสินค้า
      await ProductModel.findByIdAndUpdate(item.productId, {
        $inc: { quantity: -requiredQuantity },
      });

      // ตรวจสอบและเติมสต็อกอัตโนมัติหลังจากตัดสต็อก
      await checkAndAddStock(item.productId);
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
      promotionId: appliedPromotions,
      paymentMethod,
      cash_received: paymentMethod === "Cash" ? cash_received : 0,
      change,
      orderDate: new Date(),
    });

    await newOrder.save();

    // ล้างตะกร้าหลังจากสั่งซื้อ
    await CartModel.deleteMany({ userName });

    res.status(201).json({ 
      message: "Order created successfully", 
      order: newOrder,
      totalDiscount: totalDiscount,
      appliedPromotions: appliedPromotions
    });
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
      
      // ตรวจสอบและเติมสต็อกอัตโนมัติหลังจากคืนสต็อก
      await checkAndAddStock(item.productId);
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

exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderStatus } = req.body;
    const order = await OrderModel.findById(req.params.id);
    
    if (!order) {
      return res.status(404).json({ message: "ไม่พบคำสั่งซื้อ" });
    }

    // ตรวจสอบว่าสถานะใหม่เป็นค่าที่ถูกต้อง
    const validStatuses = ["ขายสำเร็จ", "ยกเลิก", "คืนสินค้า", "ตัดจำหน่าย"];
    if (!validStatuses.includes(orderStatus)) {
      return res.status(400).json({ 
        message: "สถานะไม่ถูกต้อง", 
        validStatuses 
      });
    }

    // ถ้าสถานะเดิมเป็น "ขายสำเร็จ" และจะเปลี่ยนเป็น "ยกเลิก" หรือ "คืนสินค้า"
    if (order.orderStatus === "ขายสำเร็จ" && (orderStatus === "ยกเลิก" || orderStatus === "คืนสินค้า")) {
      // คืนสต็อกสินค้า
      for (const item of order.products) {
        let quantityToReturn = item.quantity;
        if (item.pack) {
          const product = await ProductModel.findById(item.productId);
          if (product) {
            quantityToReturn *= product.packSize;
          }
        }
        await ProductModel.findByIdAndUpdate(item.productId, {
          $inc: { quantity: quantityToReturn }
        });
      }
    }

    // อัพเดทสถานะ
    order.orderStatus = orderStatus;
    await order.save();

    res.status(200).json({ 
      message: "อัพเดทสถานะสำเร็จ", 
      order 
    });
  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัพเดทสถานะ" });
  }
};

exports.createDisposeOrder = async (req, res) => {
  try {
    const { userName, products, orderStatus, paymentMethod, subtotal, total } = req.body;
    if (!userName || !products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: "ข้อมูลไม่ครบถ้วน" });
    }
    // ตรวจสอบว่าสินค้าทุกตัวมี productId และ quantity
    let calculatedSubtotal = 0;
    let calculatedProducts = [];
    for (const item of products) {
      if (!item.productId || !item.quantity) {
        return res.status(400).json({ message: "ข้อมูลสินค้าไม่ครบถ้วน" });
      }
      // ดึงราคาต้นทุนล่าสุด
      const product = await ProductModel.findById(item.productId);
      if (!product) {
        return res.status(404).json({ message: "ไม่พบสินค้าในระบบ" });
      }
      const purchasePrice = product.purchasePrice;
      const productTotal = purchasePrice * item.quantity;
      calculatedSubtotal += productTotal;
      // ตัดสต็อกสินค้าให้เหลือ 0
      await ProductModel.findByIdAndUpdate(item.productId, {
        quantity: 0
      });
      calculatedProducts.push({
        ...item,
        purchasePrice,
        sellingPricePerUnit: (orderStatus === 'ตัดจำหน่าย' ? purchasePrice : 0),
        originalPrice: 0,
        discountAmount: 0,
      });
    }
    const newOrder = new OrderModel({
      userName,
      products: calculatedProducts,
      subtotal: calculatedSubtotal,
      total: calculatedSubtotal,
      paymentMethod: paymentMethod || 'ตัดจำหน่าย',
      orderStatus: orderStatus || 'ตัดจำหน่าย',
      orderDate: new Date(),
    });
    await newOrder.save();
    res.status(201).json({ message: "สร้างออเดอร์ตัดจำหน่ายสินค้าเรียบร้อย", order: newOrder });
  } catch (error) {
    console.error("Error creating dispose order:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
