const PurchaseOrderModel = require("../models/PurchaseOrder");
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

    for (let item of purchaseOrder.products) {
      const product = await ProductModel.findById(item.productId);
      if (!product) {
        return res.status(404).json({ message: `Product with ID ${item.productId} not found` });
      }

      // ตรวจสอบว่ามีวันหมดอายุหรือไม่
      if (!item.expirationDate) {
        return res.status(400).json({ message: `Expiration date is required for product ${item.productId}` });
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
    }

    // เปลี่ยนสถานะของใบสั่งซื้อเป็น completed
    purchaseOrder.status = "completed";
    await purchaseOrder.save();

    return res.status(200).json({ 
      message: "Stock received and updated successfully", 
      purchaseOrder,
      details: "Check server logs for detailed update information"
    });
  } catch (error) {
    console.error("Error receiving stock:", error);
    res.status(500).json({ message: "Error receiving stock", error });
  }
};


exports.createPurchaseOrder = async (req, res) => {
  try {
    const { userId, supplierId, products, purchaseOrderDate } = req.body;

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
    const purchaseOrders = await PurchaseOrderModel.find().populate('userId supplierId products.productId');
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