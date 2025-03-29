const PurchaseOrderModel = require("../models/PurchaseOrder");
const ProductModel = require("../models/Product");

// สร้างใบสั่งซื้อใหม่
exports.createPurchaseOrder = async (req, res) => {
  try {
    const { userId, supplierId, products, subtotal, total, purchaseOrderDate } = req.body;
    const purchaseOrder = await PurchaseOrderModel.create({
      userId,
      supplierId,
      products,
      subtotal,
      total,
      purchaseOrderDate
    });
    res.status(201).json(purchaseOrder);
  } catch (error) {
    res.status(500).json({ message: "Error creating purchase order", error });
  }
};

// อ่านใบสั่งซื้อทั้งหมด
exports.getAllPurchaseOrders = async (req, res) => {
  try {
    const purchaseOrders = await PurchaseOrderModel.find().populate("supplierId userId products.productId");
    res.json(purchaseOrders);
  } catch (error) {
    res.status(500).json({ message: "Error fetching purchase orders", error });
  }
};

// อ่านใบสั่งซื้อตาม ID
exports.getPurchaseOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const purchaseOrder = await PurchaseOrderModel.findById(id).populate("supplierId userId products.productId");
    if (!purchaseOrder) return res.status(404).json({ message: "Purchase order not found" });
    res.json(purchaseOrder);
  } catch (error) {
    res.status(500).json({ message: "Error fetching purchase order", error });
  }
};

// อัปเดตใบสั่งซื้อตาม ID
exports.updatePurchaseOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const updatedPurchaseOrder = await PurchaseOrderModel.findByIdAndUpdate(id, req.body, { new: true });
    if (!updatedPurchaseOrder) return res.status(404).json({ message: "Purchase order not found" });
    res.json(updatedPurchaseOrder);
  } catch (error) {
    res.status(500).json({ message: "Error updating purchase order", error });
  }
};

// ลบใบสั่งซื้อตาม ID
exports.deletePurchaseOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedPurchaseOrder = await PurchaseOrderModel.findByIdAndDelete(id);
    if (!deletedPurchaseOrder) return res.status(404).json({ message: "Purchase order not found" });
    res.json({ message: "Purchase order deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting purchase order", error });
  }
};

// เติมสต็อกสินค้าโดยใช้ใบสั่งซื้อ
exports.updateStockFromPurchaseOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const purchaseOrder = await PurchaseOrderModel.findById(id);

    if (!purchaseOrder) return res.status(404).json({ message: "Purchase order not found" });

    for (const item of purchaseOrder.products) {
      const product = await ProductModel.findById(item.productId);
      if (product) {
        product.quantity += item.quantity;
        product.expirationDate = item.expirationDate;
        await product.save();
      }
    }
    res.json({ message: "Stock updated successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error updating stock", error });
  }
};
