const { PurchaseOrderModel, OrderNumberCounterModel } = require("../models/PurchaseOrder");
const ProductModel = require("../models/Product");

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
    let skippedProducts = [];
    let allProductsAdded = true;

    for (let item of purchaseOrder.products) {
      const product = await ProductModel.findById(item.productId);
      if (!product) {
        return res.status(404).json({ message: `Product with ID ${item.productId} not found` });
      }

      // ตรวจสอบว่ามีวันหมดอายุหรือไม่
      if (!item.expirationDate) {
        return res.status(400).json({ message: `Expiration date is required for product ${item.productId}` });
      }

      // เช็คจำนวนสินค้าคงเหลือ
      if (product.quantity > 0) {
        // ถ้ายังมีสินค้าคงเหลือ ให้ข้ามไป
        skippedProducts.push({
          productName: product.productName,
          currentStock: product.quantity,
          requestedQuantity: item.quantity
        });
        allProductsAdded = false;
        console.log(`Skipped ${product.productName}: Current stock ${product.quantity}, requested ${item.quantity}`);
        continue;
      }

      // คำนวณจำนวนสินค้าที่จะเพิ่ม
      let quantityToAdd;
      if (item.pack && product.packSize) {
        // ถ้าเป็นแพ็ค ให้คูณด้วย packSize
        quantityToAdd = item.quantity * product.packSize;
        console.log(`Adding pack: ${item.quantity} packs × ${product.packSize} units = ${quantityToAdd} units`);
      } else {
        // ถ้าเป็นชิ้น ใช้จำนวนปกติ
        quantityToAdd = item.quantity;
        console.log(`Adding units: ${quantityToAdd} units`);
      }

      // เติมสต็อกสินค้า
      product.quantity += quantityToAdd;

      // อัปเดตวันหมดอายุ
      product.expirationDate = item.expirationDate;

      // บันทึกการเปลี่ยนแปลง
      await product.save();

      // เก็บ log การเปลี่ยนแปลง
      console.log(`Updated product ${product.productName}: Added ${quantityToAdd} units, New total: ${product.quantity}`);
      
      addedProducts.push({
        productName: product.productName,
        addedQuantity: quantityToAdd,
        newTotal: product.quantity
      });
    }

    // เปลี่ยนสถานะของใบสั่งซื้อเป็น completed เฉพาะเมื่อเติมสินค้าทั้งหมดแล้ว
    if (allProductsAdded) {
    purchaseOrder.status = "completed";
    await purchaseOrder.save();

    return res.status(200).json({ 
      message: "Stock received and updated successfully", 
      purchaseOrder,
        addedProducts,
        details: "All products have been added to stock"
      });
    } else {
      // ถ้ายังมีสินค้าที่ไม่ได้เติม ให้เก็บสถานะเป็น pending
      return res.status(200).json({ 
        message: "Partial stock received", 
        purchaseOrder,
        addedProducts,
        skippedProducts,
        details: "Some products were skipped due to existing stock. They will be added automatically when stock reaches 0."
    });
    }
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

      // คำนวณราคาตามประเภทการขาย (แพ็คหรือชิ้น)
      const purchasePrice = item.pack ? product.purchasePrice * product.packSize : product.purchasePrice;
      const sellingPricePerUnit = item.pack ? product.sellingPricePerPack : product.sellingPricePerUnit;

      // คำนวณ subtotal ของแต่ละสินค้า
      const subtotal = item.quantity * purchasePrice;

      // สะสม total
      total += subtotal;

      // อัปเดตข้อมูลสินค้า
      updatedProducts.push({
        productId: item.productId,
        productName: product.productName,
        quantity: item.quantity,
        purchasePrice: purchasePrice,
        sellingPricePerUnit: sellingPricePerUnit,
        expirationDate: item.expirationDate,
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
      status: "pending"
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

    const existingPurchaseOrder = await PurchaseOrderModel.findById(purchaseOrderId);
    if (!existingPurchaseOrder) {
      return res.status(404).json({ message: "Purchase order not found" });
    }

    // ถ้าใบสั่งซื้อเป็น "completed" ต้องลดสต็อกก่อนแก้ไข
    if (existingPurchaseOrder.status === "completed") {
      for (let oldItem of existingPurchaseOrder.products) {
        const product = await ProductModel.findById(oldItem.productId);
        if (product) {
          let quantityToRemove = oldItem.quantity;
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

      // คำนวณราคาตามประเภทการขาย (แพ็คหรือชิ้น)
      const purchasePrice = item.pack ? product.purchasePrice * product.packSize : product.purchasePrice;
      const sellingPricePerUnit = item.pack ? product.sellingPricePerPack : product.sellingPricePerUnit;

      // คำนวณ subtotal
      const subtotal = item.quantity * purchasePrice;
      total += subtotal;

      updatedProducts.push({
        productId: item.productId,
        productName: product.productName,
        quantity: item.quantity,
        purchasePrice: purchasePrice,
        sellingPricePerUnit: sellingPricePerUnit,
        expirationDate: item.expirationDate,
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
          let quantityToAdd = newItem.quantity;
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
          product.quantity -= item.quantity; // ลดจำนวนที่เติมไปแล้ว
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
        quantityToAdd = orderItem.quantity * product.packSize;
      } else {
        quantityToAdd = orderItem.quantity;
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
        expectedQuantity = item.quantity * product.packSize;
      } else {
        expectedQuantity = item.quantity;
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
        quantityToAdd = item.quantity * product.packSize;
      } else {
        quantityToAdd = item.quantity;
      }

      // เติมสต็อกสินค้า
      const oldQuantity = product.quantity;
      product.quantity += quantityToAdd;
      product.expirationDate = item.expirationDate;
      await product.save();

      addedProducts.push({
        productName: product.productName,
        addedQuantity: quantityToAdd,
        oldQuantity,
        newQuantity: product.quantity
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