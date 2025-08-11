const { PurchaseOrderModel, OrderNumberCounterModel } = require("../models/PurchaseOrder");
const ProductModel = require("../models/Product");

// ฟังก์ชันใหม่สำหรับอัพเดทข้อมูลการส่งมอบ
exports.updateDeliveryInfo = async (req, res) => {
  try {
    const purchaseOrderId = req.params.id;
    const { deliveryData } = req.body; // [{ productId, deliveredQuantity, actualPrice, deliveryDate, deliveryNotes }]

    const purchaseOrder = await PurchaseOrderModel.findById(purchaseOrderId);
    if (!purchaseOrder) {
      return res.status(404).json({ message: "Purchase order not found" });
    }

    // อัพเดทข้อมูลการส่งมอบสำหรับแต่ละสินค้า
    for (const delivery of deliveryData) {
      const productIndex = purchaseOrder.products.findIndex(
        p => p.productId.toString() === delivery.productId
      );

      if (productIndex !== -1) {
        // ใช้ค่าที่ส่งมาจาก frontend โดยตรง (รวมถึง 0)
        purchaseOrder.products[productIndex].deliveredQuantity = delivery.deliveredQuantity;
        purchaseOrder.products[productIndex].actualPrice = delivery.actualPrice;
        purchaseOrder.products[productIndex].deliveryDate = delivery.deliveryDate;
        purchaseOrder.products[productIndex].deliveryNotes = delivery.deliveryNotes;
      }
    }

    // ไม่ต้องคำนวณสถานะการส่งมอบ - ให้คงสถานะเดิมไว้
    // สถานะจะถูกอัปเดตเป็น "fully_delivered" เมื่อเติมสินค้าเท่านั้น

    await purchaseOrder.save();

    res.status(200).json({ 
      message: "Delivery information updated successfully", 
      purchaseOrder 
    });
  } catch (error) {
    console.error("Error updating delivery info:", error);
    res.status(500).json({ message: "Error updating delivery info", error });
  }
};

// ฟังก์ชันใหม่สำหรับรับสต็อกจากข้อมูลการส่งมอบจริง
exports.receiveStockFromDelivery = async (req, res) => {
  try {
    const purchaseOrderId = req.params.id;
    const purchaseOrder = await PurchaseOrderModel.findById(purchaseOrderId);
    
    if (!purchaseOrder) {
      return res.status(404).json({ message: "Purchase order not found" });
    }

    // เช็คว่าใบสั่งซื้อได้รับการเติมสต็อกแล้วหรือยัง
    if (purchaseOrder.status === "completed") {
      return res.status(400).json({ message: "This purchase order has already been completed" });
    }

    // เช็คว่ามีข้อมูลการส่งมอบหรือไม่
    if (purchaseOrder.deliveryStatus === "not_delivered") {
      return res.status(400).json({ message: "No delivery information available. Please update delivery info first." });
    }

    let addedProducts = [];

    for (let item of purchaseOrder.products) {
      const product = await ProductModel.findById(item.productId);
      if (!product) {
        return res.status(404).json({ message: `Product with ID ${item.productId} not found` });
      }

      // ใช้ข้อมูลการส่งมอบจริง
      const deliveredQuantity = item.deliveredQuantity || 0;
      if (deliveredQuantity === 0) {
        console.log(`Skipping product ${product.productName}: deliveredQuantity is 0`);
        continue; // ข้ามสินค้าที่ยังไม่ส่งมอบ
      }

      // ✅ ตรวจสอบว่ามีวันหมดอายุหรือไม่ (ไม่บังคับ)
      // if (!item.expirationDate) {
      //   return res.status(400).json({ message: `Expiration date is required for product ${item.productId}` });
      // }

      // คำนวณจำนวนสินค้าที่จะเพิ่มเป็นล็อต
      let quantityToAdd;
      if (item.pack && product.packSize) {
        // ถ้าเป็นแพ็ค ให้คูณด้วย packSize
        quantityToAdd = deliveredQuantity * product.packSize;
      } else {
        // ถ้าเป็นชิ้น ใช้จำนวนปกติ
        quantityToAdd = deliveredQuantity;
      }

      // ใช้ราคาจริงที่ส่งมอบ
      let actualPurchasePrice = item.actualPrice || item.estimatedPrice;
      
      // ถ้าเป็นแพ็ค ให้หารด้วย packSize เพื่อได้ราคาต่อชิ้น
      if (item.pack && product.packSize && product.packSize > 0) {
        actualPurchasePrice = actualPurchasePrice / product.packSize;
      }

      // ✅ สร้างล็อตใหม่แทนการเพิ่ม quantity
      await product.addLot({
        quantity: quantityToAdd,
        purchasePrice: actualPurchasePrice, // ราคาต่อชิ้น
        expirationDate: item.expirationDate || null, // ถ้าไม่มีวันหมดอายุให้เป็น null
        purchaseOrderId: purchaseOrderId
      });


      
      addedProducts.push({
        productName: product.productName,
        deliveredQuantity: deliveredQuantity,
        addedQuantity: quantityToAdd,
        purchasePricePerUnit: actualPurchasePrice,
        newTotal: product.totalQuantity
      });
    }

    // ✅ เปลี่ยนสถานะของใบสั่งซื้อเป็น completed เมื่อเติมสินค้าทั้งหมดแล้ว
    purchaseOrder.status = "completed";
    await purchaseOrder.save();

    return res.status(200).json({ 
      message: "Stock received and updated successfully from delivery data", 
      purchaseOrder,
      addedProducts,
      details: "Products have been added to stock based on actual delivery"
    });
  } catch (error) {
    console.error("Error receiving stock from delivery:", error);
    res.status(500).json({ message: "Error receiving stock from delivery", error });
  }
};

exports.receiveStock = async (req, res) => {
  try {
    const purchaseOrderId = req.params.id;
    const purchaseOrder = await PurchaseOrderModel.findById(purchaseOrderId);
    
    if (!purchaseOrder) {
      return res.status(404).json({ message: "Purchase order not found" });
    }

    // เช็คว่าใบสั่งซื้อได้รับการเติมสต็อกแล้วหรือยัง
    if (purchaseOrder.status === "completed") {
      return res.status(400).json({ message: "This purchase order has already been completed" });
    }

    let addedProducts = [];

    for (let item of purchaseOrder.products) {
      const product = await ProductModel.findById(item.productId);
      if (!product) {
        return res.status(404).json({ message: `Product with ID ${item.productId} not found` });
      }

      // ✅ ตรวจสอบว่ามีวันหมดอายุหรือไม่ (ไม่บังคับ)
      // if (!item.expirationDate) {
      //   return res.status(400).json({ message: `Expiration date is required for product ${item.productId}` });
      // }

      // ✅ ระบบล็อตใหม่ - เพิ่มสต็อกใหม่ได้เสมอ ไม่ว่าสต็อกเก่าจะเหลือหรือไม่

      // ตรวจสอบว่ามีการส่งมอบหรือไม่
      const deliveredQty = item.deliveredQuantity || 0;
      if (deliveredQty === 0) {
        console.log(`Skipping product ${product.productName}: deliveredQuantity is 0`);
        continue; // ข้ามสินค้าที่ยังไม่ส่งมอบ
      }

      // คำนวณจำนวนสินค้าที่จะเพิ่มเป็นล็อต
      let quantityToAdd;
      if (item.pack && product.packSize) {
        // ถ้าเป็นแพ็ค ให้คูณด้วย packSize
        quantityToAdd = deliveredQty * product.packSize;
      } else {
        // ถ้าเป็นชิ้น ใช้จำนวนปกติ
        quantityToAdd = deliveredQty;
      }

      // ใช้ราคาจริงที่ส่งมอบ
      let actualPurchasePrice = item.actualPrice || item.estimatedPrice;
      
      // ถ้าเป็นแพ็ค ให้หารด้วย packSize เพื่อได้ราคาต่อชิ้น
      if (item.pack && product.packSize && product.packSize > 0) {
        actualPurchasePrice = actualPurchasePrice / product.packSize;
        console.log(`Converting pack price to unit price: ${item.actualPrice || item.estimatedPrice} / ${product.packSize} = ${actualPurchasePrice}`);
      }

      // ✅ สร้างล็อตใหม่แทนการเพิ่ม quantity
      await product.addLot({
        quantity: quantityToAdd,
        purchasePrice: actualPurchasePrice, // ราคาต่อชิ้น
        expirationDate: item.expirationDate || null, // ถ้าไม่มีวันหมดอายุให้เป็น null
        purchaseOrderId: purchaseOrderId
      });

      // เก็บ log การเปลี่ยนแปลง
      console.log(`Updated product ${product.productName}: Added ${quantityToAdd} units, New total: ${product.totalQuantity}`);
      
      addedProducts.push({
        productName: product.productName,
        addedQuantity: quantityToAdd,
        purchasePricePerUnit: actualPurchasePrice,
        newTotal: product.totalQuantity
      });
    }

    // ✅ เปลี่ยนสถานะของใบสั่งซื้อเป็น completed เมื่อเติมสินค้าทั้งหมดแล้ว
    purchaseOrder.status = "completed";
    
    // เมื่อเติมสินค้าแล้ว ให้สถานะเป็น "ส่งมอบครบแล้ว" เท่านั้น
    purchaseOrder.deliveryStatus = "fully_delivered";
    
    await purchaseOrder.save();

    return res.status(200).json({ 
      message: "Stock received and updated successfully", 
      purchaseOrder,
      addedProducts,
      details: "All products have been added to stock"
    });
  } catch (error) {
    console.error("Error receiving stock:", error);
    res.status(500).json({ message: "Error receiving stock", error });
  }
};

exports.createPurchaseOrder = async (req, res) => {
  try {
    const { userId, supplierId, products, purchaseOrderDate } = req.body;

    // สร้างเลขใบสั่งซื้ออัตโนมัติ
    const orderNumber = await generateOrderNumber();

    let total = 0;
    const updatedProducts = [];

    for (const item of products) {
      const product = await ProductModel.findById(item.productId);
      if (!product) {
        return res.status(404).json({ message: `Product not found for ID: ${item.productId}` });
      }

      // ✅ ใช้ราคาซื้อที่ frontend ส่งมา (item.estimatedPrice) แทนที่จะใช้ averagePurchasePrice
      const estimatedPrice = item.estimatedPrice || 0;
      const sellingPricePerUnit = item.sellingPricePerUnit || (item.pack ? product.sellingPricePerPack : product.sellingPricePerUnit);

      // คำนวณ subtotal ของแต่ละสินค้า
      const subtotal = item.orderedQuantity * estimatedPrice;

      // สะสม total
      total += subtotal;

      // อัปเดตข้อมูลสินค้า
      updatedProducts.push({
        productId: item.productId,
        productName: product.productName,
        orderedQuantity: item.orderedQuantity,
        estimatedPrice: estimatedPrice,
        deliveredQuantity: 0, // เริ่มต้นเป็น 0
        actualPrice: null, // ยังไม่มีราคาจริง
        deliveryDate: null, // ยังไม่มีวันที่ส่งมอบ
        deliveryNotes: "", // ยังไม่มีหมายเหตุ
        sellingPricePerUnit: sellingPricePerUnit,
        expirationDate: item.expirationDate || null, // ถ้าไม่มีวันหมดอายุให้เป็น null
        subtotal: subtotal,
        pack: item.pack,
        packSize: item.packSize || product.packSize
      });
    }

    // สร้างใบสั่งซื้อใหม่
    const purchaseOrder = new PurchaseOrderModel({
      userId,
      supplierId,
      orderNumber, // เพิ่มเลขใบสั่งซื้อ
      products: updatedProducts,
      total,
      purchaseOrderDate,
      status: "pending",
      deliveryStatus: "not_delivered"
    });

    await purchaseOrder.save();
    res.status(201).json({ message: "Purchase order created successfully", purchaseOrder });
  } catch (error) {
    console.error("Error creating purchase order:", error);
    res.status(500).json({ message: "Error creating purchase order", error });
  }
};
exports.getAllPurchaseOrders = async (req, res) => {
  try {
    const purchaseOrders = await PurchaseOrderModel.find()
      .populate('userId supplierId products.productId')
      .sort({ orderNumber: 1 }); // เรียงตามเลขใบสั่งซื้อ
    res.status(200).json(purchaseOrders);
  } catch (error) {
    console.error("Error fetching purchase orders:", error);
    res.status(500).json({ message: "Error fetching purchase orders", error });
  }
};
exports.updatePurchaseOrder = async (req, res) => {
  try {
    const purchaseOrderId = req.params.id;
    const { products, supplierId, purchaseOrderDate } = req.body;

    console.log('Received update data:', { products, supplierId, purchaseOrderDate });

    const existingPurchaseOrder = await PurchaseOrderModel.findById(purchaseOrderId);
    if (!existingPurchaseOrder) {
      return res.status(404).json({ message: "Purchase order not found" });
    }

    // ถ้าใบสั่งซื้อเป็น "completed" ต้องลดสต็อกก่อนแก้ไข
    if (existingPurchaseOrder.status === "completed") {
      for (let oldItem of existingPurchaseOrder.products) {
        const product = await ProductModel.findById(oldItem.productId);
        if (product) {
          let quantityToRemove = oldItem.orderedQuantity;
          if (oldItem.pack && product.packSize) {
            quantityToRemove *= product.packSize;
          }
          product.quantity -= quantityToRemove;
          await product.save();
        }
      }
    }

    let total = 0;
    const updatedProducts = [];

    // อัปเดตข้อมูลสินค้า
    for (let item of products) {
      const product = await ProductModel.findById(item.productId);
      if (!product) {
        return res.status(404).json({ message: `Product not found for ID: ${item.productId}` });
      }

      // ใช้ราคาที่ส่งมาจาก frontend แทนราคาจากฐานข้อมูลสินค้า - ใช้ averagePurchasePrice
      const estimatedPrice = item.estimatedPrice || (item.pack ? (product.averagePurchasePrice || 0) * product.packSize : (product.averagePurchasePrice || 0));
      const sellingPricePerUnit = item.sellingPricePerUnit || (item.pack ? product.sellingPricePerPack : product.sellingPricePerUnit);

      // คำนวณ subtotal
      const subtotal = item.orderedQuantity * estimatedPrice;
      total += subtotal;

      // เก็บข้อมูลการส่งมอบเดิมไว้
      const existingProduct = existingPurchaseOrder.products.find(p => p.productId.toString() === item.productId);
      // ถ้า frontend ส่ง deliveredQuantity มา (รวมถึง 0) ให้ใช้ค่านั้น
      // ถ้าไม่ได้ส่งมา ให้ใช้ค่าจากฐานข้อมูลเดิม
      const deliveredQuantity = item.hasOwnProperty('deliveredQuantity') ? item.deliveredQuantity : (existingProduct ? existingProduct.deliveredQuantity : 0);
      const actualPrice = item.actualPrice !== undefined ? item.actualPrice : (existingProduct ? existingProduct.actualPrice : null);
      const deliveryDate = item.deliveryDate !== undefined ? item.deliveryDate : (existingProduct ? existingProduct.deliveryDate : null);
      const deliveryNotes = item.deliveryNotes !== undefined ? item.deliveryNotes : (existingProduct ? existingProduct.deliveryNotes : "");

      console.log(`Product ${item.productId} delivery data:`, {
        deliveredQuantity,
        actualPrice,
        deliveryDate,
        deliveryNotes,
        fromItem: {
          deliveredQuantity: item.deliveredQuantity,
          actualPrice: item.actualPrice,
          deliveryDate: item.deliveryDate,
          deliveryNotes: item.deliveryNotes
        }
      });

      updatedProducts.push({
        productId: item.productId,
        productName: product.productName,
        orderedQuantity: item.orderedQuantity,
        estimatedPrice: estimatedPrice,
        deliveredQuantity: deliveredQuantity,
        actualPrice: actualPrice,
        deliveryDate: deliveryDate,
        deliveryNotes: deliveryNotes,
        sellingPricePerUnit: sellingPricePerUnit,
        expirationDate: item.expirationDate || null, // ถ้าไม่มีวันหมดอายุให้เป็น null
        subtotal: subtotal,
        pack: item.pack,
        packSize: item.packSize || product.packSize
      });
    }

    // อัปเดตใบสั่งซื้อ
    const updatedPurchaseOrder = await PurchaseOrderModel.findByIdAndUpdate(
      purchaseOrderId,
      {
        supplierId,
        purchaseOrderDate,
        products: updatedProducts,
        total
      },
      { new: true }
    );

    if (!updatedPurchaseOrder) {
      return res.status(404).json({ message: "Purchase order not found" });
    }

    // ถ้าใบสั่งซื้อเป็น "completed" ต้องเติมสต็อกใหม่หลังแก้ไข
    if (updatedPurchaseOrder.status === "completed") {
      for (let newItem of updatedPurchaseOrder.products) {
        const product = await ProductModel.findById(newItem.productId);
        if (product) {
          let quantityToAdd = newItem.orderedQuantity;
          if (newItem.pack && product.packSize) {
            quantityToAdd *= product.packSize;
          }
          product.quantity += quantityToAdd;
          await product.save();
        }
      }
    }

    res.status(200).json({ message: "Purchase order updated successfully", updatedPurchaseOrder });
  } catch (error) {
    console.error("Error updating purchase order:", error);
    res.status(500).json({ message: "Error updating purchase order", error });
  }
};


exports.deletePurchaseOrder = async (req, res) => {
  try {
    const purchaseOrderId = req.params.id;

    const purchaseOrder = await PurchaseOrderModel.findById(purchaseOrderId);
    if (!purchaseOrder) {
      return res.status(404).json({ message: "Purchase order not found" });
    }

    // ถ้าใบสั่งซื้อเป็น "completed" ต้องคืนสต็อกก่อนลบ
    if (purchaseOrder.status === "completed") {
      for (let item of purchaseOrder.products) {
        const product = await ProductModel.findById(item.productId);
        if (product) {
          product.quantity -= item.orderedQuantity; // ลดจำนวนที่เติมไปแล้ว
          await product.save();
        }
      }
    }

    // ลบใบสั่งซื้อ
    await PurchaseOrderModel.findByIdAndDelete(purchaseOrderId);

    res.status(200).json({ message: "Purchase order deleted successfully" });
  } catch (error) {
    console.error("Error deleting purchase order:", error);
    res.status(500).json({ message: "Error deleting purchase order", error });
  }
};

exports.getPurchaseOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const purchaseOrder = await PurchaseOrderModel.findById(id)
      .populate("userId", "name email")
      .populate("supplierId", "name contact")
      .populate("products.productId", "name category")
      .lean();

    if (!purchaseOrder) {
      return res.status(404).json({ message: "Purchase Order not found" });
    }

    res.status(200).json(purchaseOrder);
  } catch (error) {
    console.error("Error fetching purchase order:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// ฟังก์ชันสร้างเลขใบสั่งซื้ออัตโนมัติ
const generateOrderNumber = async () => {
  try {
    // หา counter ปัจจุบัน
    let counter = await OrderNumberCounterModel.findOne();
    
    if (!counter) {
      // ถ้ายังไม่มี counter ให้สร้างใหม่
      counter = new OrderNumberCounterModel({ counter: 1 });
    } else {
      // เพิ่ม counter ขึ้น 1
      counter.counter += 1;
    }
    
    await counter.save();
    return counter.counter;
  } catch (error) {
    console.error("Error generating order number:", error);
    throw error;
  }
};

// ฟังก์ชันตรวจสอบและเติมสต็อกอัตโนมัติ
exports.checkAndAddStock = async (productId) => {
  try {
    const product = await ProductModel.findById(productId);
    if (!product || product.quantity > 0) {
      return; // ไม่ต้องทำอะไรถ้าสินค้าไม่มีหรือยังมีสต็อก
    }

    // หาใบสั่งซื้อที่ยังไม่เสร็จและมีสินค้านี้
    const pendingOrders = await PurchaseOrderModel.find({
      status: "pending",
      "products.productId": productId
    }).sort({ createdAt: 1 }); // เรียงตามวันที่สร้าง (เก่าสุดก่อน)

    for (const order of pendingOrders) {
      const orderItem = order.products.find(item => 
        item.productId.toString() === productId.toString()
      );

      if (!orderItem) continue;

      // ตรวจสอบว่ามีวันหมดอายุหรือไม่
      if (!orderItem.expirationDate) {
        console.log(`Skipping ${product.productName}: No expiration date in order ${order.orderNumber}`);
        continue;
      }

      // คำนวณจำนวนสินค้าที่จะเพิ่ม
      let quantityToAdd;
      if (orderItem.pack && product.packSize) {
        quantityToAdd = orderItem.orderedQuantity * product.packSize;
      } else {
        quantityToAdd = orderItem.orderedQuantity;
      }

      // เติมสต็อกสินค้าทั้งหมดในครั้งเดียว
      product.quantity += quantityToAdd;
      product.expirationDate = orderItem.expirationDate;
      await product.save();

      console.log(`Auto-added ${quantityToAdd} units of ${product.productName} from order ${order.orderNumber}`);

      // ตรวจสอบว่าใบสั่งซื้อนี้เติมสินค้าทั้งหมดแล้วหรือยัง
      const allProductsAdded = await checkIfOrderComplete(order);
      if (allProductsAdded) {
        order.status = "completed";
        await order.save();
        console.log(`Order ${order.orderNumber} marked as completed`);
      }

      break; // เติมจากใบสั่งซื้อแรกที่เจอเท่านั้น
    }
  } catch (error) {
    console.error("Error in checkAndAddStock:", error);
  }
};

// ฟังก์ชันตรวจสอบว่าใบสั่งซื้อเติมสินค้าทั้งหมดแล้วหรือยัง
const checkIfOrderComplete = async (order) => {
  try {
    // ตรวจสอบสินค้าทั้งหมดในใบสั่งซื้อ
    for (const item of order.products) {
      const product = await ProductModel.findById(item.productId);
      if (!product) {
        continue; // ข้ามถ้าสินค้าไม่มี
      }

      // คำนวณจำนวนสินค้าที่ควรมีในสต็อก
      let expectedQuantity = 0;
      if (item.pack && product.packSize) {
        expectedQuantity = item.orderedQuantity * product.packSize;
      } else {
        expectedQuantity = item.orderedQuantity;
      }

      // ถ้าสินค้านี้ยังไม่มีสต็อกที่เพียงพอ (น้อยกว่า expectedQuantity) 
      // แสดงว่ายังไม่ควรเปลี่ยนสถานะใบสั่งซื้อเป็น completed
      if (product.quantity < expectedQuantity) {
        console.log(`Order ${order.orderNumber} not complete: ${product.productName} has ${product.quantity}/${expectedQuantity}`);
        return false;
      }
    }
    
    // ถ้าสินค้าทั้งหมดมีสต็อกเพียงพอแล้ว
    console.log(`Order ${order.orderNumber} is complete - all products have sufficient stock`);
    return true;
  } catch (error) {
    console.error("Error checking if order complete:", error);
    return false;
  }
};

// API endpoint สำหรับตรวจสอบและเติมสต็อกอัตโนมัติ
exports.autoAddStock = async (req, res) => {
  try {
    const { productId } = req.params;
    
    if (!productId) {
      return res.status(400).json({ message: "Product ID is required" });
    }

    await checkAndAddStock(productId);
    
    const product = await ProductModel.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.status(200).json({ 
      message: "Auto stock check completed",
      product: {
        id: product._id,
        name: product.productName,
        currentStock: product.quantity
      }
    });
  } catch (error) {
    console.error("Error in autoAddStock:", error);
    res.status(500).json({ message: "Error checking and adding stock", error });
  }
};

// API endpoint สำหรับตรวจสอบและเติมสต็อกอัตโนมัติทั้งหมด
exports.autoAddStockAll = async (req, res) => {
  try {
    // หาสินค้าทั้งหมดที่มีสต็อก = 0
    const productsWithZeroStock = await ProductModel.find({ quantity: 0 });
    
    let results = [];
    
    for (const product of productsWithZeroStock) {
      const beforeStock = product.quantity;
      await checkAndAddStock(product._id);
      
      // ดึงข้อมูลสินค้าหลังจากอัปเดต
      const updatedProduct = await ProductModel.findById(product._id);
      
      results.push({
        productId: product._id,
        productName: product.productName,
        beforeStock,
        afterStock: updatedProduct.quantity,
        stockAdded: updatedProduct.quantity - beforeStock
      });
    }
    
    res.status(200).json({ 
      message: "Auto stock check completed for all products",
      results,
      totalProductsChecked: productsWithZeroStock.length
    });
  } catch (error) {
    console.error("Error in autoAddStockAll:", error);
    res.status(500).json({ message: "Error checking and adding stock for all products", error });
  }
};

// ฟังก์ชันเติมสต็อกทั้งหมดในใบสั่งซื้อในครั้งเดียว
exports.addAllStockFromOrder = async (orderId) => {
  try {
    const order = await PurchaseOrderModel.findById(orderId);
    if (!order) {
      throw new Error("Purchase order not found");
    }

    if (order.status === "completed") {
      throw new Error("This purchase order has already been completed");
    }

    let addedProducts = [];
    let skippedProducts = [];

    // ตรวจสอบและเติมสต็อกสินค้าทั้งหมดในใบสั่งซื้อ
    for (const item of order.products) {
      const product = await ProductModel.findById(item.productId);
      if (!product) {
        console.log(`Product not found: ${item.productId}`);
        continue;
      }

      // ตรวจสอบว่ามีวันหมดอายุหรือไม่
      if (!item.expirationDate) {
        console.log(`Skipping ${product.productName}: No expiration date`);
        skippedProducts.push({
          productName: product.productName,
          reason: "ไม่มีวันหมดอายุ"
        });
        continue;
      }

      // คำนวณจำนวนสินค้าที่จะเพิ่ม
      let quantityToAdd;
      if (item.pack && product.packSize) {
        quantityToAdd = item.orderedQuantity * product.packSize;
      } else {
        quantityToAdd = item.orderedQuantity;
      }

      // ใช้ราคาจริงที่ส่งมอบ
      let actualPurchasePrice = item.actualPrice || item.estimatedPrice;
      
      // ถ้าเป็นแพ็ค ให้หารด้วย packSize เพื่อได้ราคาต่อชิ้น
      if (item.pack && product.packSize && product.packSize > 0) {
        actualPurchasePrice = actualPurchasePrice / product.packSize;
        console.log(`Converting pack price to unit price: ${item.actualPrice || item.estimatedPrice} / ${product.packSize} = ${actualPurchasePrice}`);
      }

      // ✅ สร้างล็อตใหม่แทนการเพิ่ม quantity
      await product.addLot({
        quantity: quantityToAdd,
        purchasePrice: actualPurchasePrice, // ราคาต่อชิ้น
        expirationDate: item.expirationDate || null, // ถ้าไม่มีวันหมดอายุให้เป็น null
        purchaseOrderId: order._id
      });

      addedProducts.push({
        productName: product.productName,
        addedQuantity: quantityToAdd,
        purchasePricePerUnit: actualPurchasePrice,
        newTotal: product.totalQuantity
      });

      console.log(`Added ${quantityToAdd} units of ${product.productName} (${oldQuantity} -> ${product.quantity})`);
    }

    // เปลี่ยนสถานะใบสั่งซื้อเป็น completed
    order.status = "completed";
    await order.save();

    return {
      success: true,
      message: "All stock added successfully",
      addedProducts,
      skippedProducts,
      orderNumber: order.orderNumber
    };

  } catch (error) {
    console.error("Error adding all stock from order:", error);
    throw error;
  }
};

// ฟังก์ชันตรวจสอบและเติมสต็อกอัตโนมัติสำหรับสินค้าทั้งหมดที่มีสต็อก = 0
exports.autoAddStockForAllZeroStock = async () => {
  try {
    // หาสินค้าทั้งหมดที่มีสต็อก = 0
    const productsWithZeroStock = await ProductModel.find({ quantity: 0 });
    
    let results = [];
    let totalAdded = 0;

    for (const product of productsWithZeroStock) {
      const beforeStock = product.quantity;
      
      // เรียกใช้ฟังก์ชันเติมสต็อกอัตโนมัติ
      await this.checkAndAddStock(product._id);
      
      // ดึงข้อมูลสินค้าหลังจากอัปเดต
      const updatedProduct = await ProductModel.findById(product._id);
      
      const stockAdded = updatedProduct.quantity - beforeStock;
      if (stockAdded > 0) {
        totalAdded += stockAdded;
        results.push({
          productId: product._id,
          productName: product.productName,
          beforeStock,
          afterStock: updatedProduct.quantity,
          stockAdded
        });
      }
    }
    
    return {
      success: true,
      message: `Auto stock check completed. Added stock for ${results.length} products.`,
      results,
      totalProductsChecked: productsWithZeroStock.length,
      totalStockAdded: totalAdded
    };
  } catch (error) {
    console.error("Error in autoAddStockForAllZeroStock:", error);
    throw error;
  }
};

// ฟังก์ชันใหม่: อัปเดตใบสั่งซื้อและสร้างล็อตใหม่ (สำหรับแก้ไขข้อมูลการรับสินค้า)
exports.updatePurchaseOrderAndRecreateLots = async (req, res) => {
  try {
    const purchaseOrderId = req.params.id;
    const { products, supplierId, purchaseOrderDate } = req.body;

    console.log('Received update and recreate data:', { products, supplierId, purchaseOrderDate });

    const existingPurchaseOrder = await PurchaseOrderModel.findById(purchaseOrderId);
    if (!existingPurchaseOrder) {
      return res.status(404).json({ message: "Purchase order not found" });
    }

    // ตรวจสอบว่าใบสั่งซื้อเป็น "completed" หรือไม่
    if (existingPurchaseOrder.status !== "completed") {
      return res.status(400).json({ message: "This purchase order is not completed yet" });
    }

    // ลบล็อตเดิมที่สร้างจากใบสั่งซื้อนี้
    for (let oldItem of existingPurchaseOrder.products) {
      const product = await ProductModel.findById(oldItem.productId);
      if (product) {
        // หาล็อตที่สร้างจากใบสั่งซื้อนี้และลบออก
        const lotsToRemove = product.lots.filter(lot => 
          lot.purchaseOrderId && lot.purchaseOrderId.toString() === purchaseOrderId
        );
        
        for (const lot of lotsToRemove) {
          // ลบล็อตออกจาก array
          product.lots = product.lots.filter(l => l.lotNumber !== lot.lotNumber);
        }
        
        await product.save();
        console.log(`Removed ${lotsToRemove.length} lots from product ${product.productName}`);
      }
    }

    let total = 0;
    const updatedProducts = [];

    // อัปเดตข้อมูลสินค้า
    for (let item of products) {
      const product = await ProductModel.findById(item.productId);
      if (!product) {
        return res.status(404).json({ message: `Product not found for ID: ${item.productId}` });
      }

      // ใช้ราคาที่ส่งมาจาก frontend
      const estimatedPrice = item.estimatedPrice || (item.pack ? (product.averagePurchasePrice || 0) * product.packSize : (product.averagePurchasePrice || 0));
      const sellingPricePerUnit = item.sellingPricePerUnit || (item.pack ? product.sellingPricePerPack : product.sellingPricePerUnit);

      // คำนวณ subtotal
      const subtotal = item.orderedQuantity * estimatedPrice;
      total += subtotal;

      // เก็บข้อมูลการส่งมอบเดิมไว้
      const existingProduct = existingPurchaseOrder.products.find(p => p.productId.toString() === item.productId);
      // ถ้า frontend ส่ง deliveredQuantity มา (รวมถึง 0) ให้ใช้ค่านั้น
      // ถ้าไม่ได้ส่งมา ให้ใช้ค่าจากฐานข้อมูลเดิม
      const deliveredQuantity = item.hasOwnProperty('deliveredQuantity') ? item.deliveredQuantity : (existingProduct ? existingProduct.deliveredQuantity : 0);
      const actualPrice = item.actualPrice !== undefined ? item.actualPrice : (existingProduct ? existingProduct.actualPrice : null);
      const deliveryDate = item.deliveryDate !== undefined ? item.deliveryDate : (existingProduct ? existingProduct.deliveryDate : null);
      const deliveryNotes = item.deliveryNotes !== undefined ? item.deliveryNotes : (existingProduct ? existingProduct.deliveryNotes : "");

      updatedProducts.push({
        productId: item.productId,
        productName: product.productName,
        orderedQuantity: item.orderedQuantity,
        estimatedPrice: estimatedPrice,
        deliveredQuantity: deliveredQuantity,
        actualPrice: actualPrice,
        deliveryDate: deliveryDate,
        deliveryNotes: deliveryNotes,
        sellingPricePerUnit: sellingPricePerUnit,
        expirationDate: item.expirationDate || null, // ถ้าไม่มีวันหมดอายุให้เป็น null
        subtotal: subtotal,
        pack: item.pack,
        packSize: item.packSize || product.packSize
      });
    }

    // อัปเดตใบสั่งซื้อ
    const updatedPurchaseOrder = await PurchaseOrderModel.findByIdAndUpdate(
      purchaseOrderId,
      {
        supplierId,
        purchaseOrderDate,
        products: updatedProducts,
        total
      },
      { new: true }
    );

    if (!updatedPurchaseOrder) {
      return res.status(404).json({ message: "Purchase order not found" });
    }

    // สร้างล็อตใหม่ตามข้อมูลที่อัปเดต
    let addedProducts = [];
    for (let item of updatedPurchaseOrder.products) {
      const product = await ProductModel.findById(item.productId);
      if (!product) {
        continue;
      }

      // ✅ ไม่ต้องตรวจสอบวันหมดอายุ - ให้สร้างล็อตได้เสมอ (รวมถึงล็อตที่ไม่มีวันหมดอายุ)
      // if (!item.expirationDate) {
      //   continue;
      // }

      // ตรวจสอบว่ามีการส่งมอบหรือไม่
      const deliveredQty = item.deliveredQuantity || 0;
      if (deliveredQty === 0) {
        console.log(`Skipping product ${product.productName}: deliveredQuantity is 0`);
        continue; // ข้ามสินค้าที่ยังไม่ส่งมอบ
      }

      // คำนวณจำนวนสินค้าที่จะเพิ่มเป็นล็อต
      let quantityToAdd;
      if (item.pack && product.packSize) {
        quantityToAdd = deliveredQty * product.packSize;
      } else {
        quantityToAdd = deliveredQty;
      }

      // ใช้ราคาจริงที่ส่งมอบ
      let actualPurchasePrice = item.actualPrice || item.estimatedPrice;
      
      // ถ้าเป็นแพ็ค ให้หารด้วย packSize เพื่อได้ราคาต่อชิ้น
      if (item.pack && product.packSize && product.packSize > 0) {
        actualPurchasePrice = actualPurchasePrice / product.packSize;
      }

      // สร้างล็อตใหม่
      await product.addLot({
        quantity: quantityToAdd,
        purchasePrice: actualPurchasePrice,
        expirationDate: item.expirationDate || null, // ถ้าไม่มีวันหมดอายุให้เป็น null
        purchaseOrderId: purchaseOrderId
      });

      addedProducts.push({
        productName: product.productName,
        addedQuantity: quantityToAdd,
        purchasePricePerUnit: actualPurchasePrice,
        newTotal: product.totalQuantity
      });
    }

    // เมื่อเติมสินค้าแล้ว ให้สถานะเป็น "ส่งมอบครบแล้ว" เท่านั้น
    updatedPurchaseOrder.deliveryStatus = "fully_delivered";
    
    await updatedPurchaseOrder.save();

    res.status(200).json({ 
      message: "Purchase order updated and lots recreated successfully", 
      updatedPurchaseOrder,
      addedProducts
    });
  } catch (error) {
    console.error("Error updating purchase order and recreating lots:", error);
    res.status(500).json({ message: "Error updating purchase order and recreating lots", error });
  }
};