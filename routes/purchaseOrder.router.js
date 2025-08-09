const express = require("express");
const router = express.Router();
const {
  receiveStock, 
  receiveStockFromDelivery,
  updateDeliveryInfo,
  createPurchaseOrder, 
  getPurchaseOrderById, 
  getAllPurchaseOrders, 
  updatePurchaseOrder, 
  deletePurchaseOrder,
  autoAddStock,
  autoAddStockAll,
  addAllStockFromOrder,
  autoAddStockForAllZeroStock,
  updatePurchaseOrderAndRecreateLots
} = require("../controllers/purchaseOrder.controller");
const updateProductStatus = require("../middlewares/productStatusMiddleware");

router.post("/",createPurchaseOrder);
router.post("/:id/receive", updateProductStatus, receiveStock);
router.post("/:id/receive-from-delivery", updateProductStatus, receiveStockFromDelivery);
router.put("/:id/delivery-info",updateDeliveryInfo);
router.get("/",getAllPurchaseOrders);
router.get("/:id",getPurchaseOrderById);
router.put("/:id",updatePurchaseOrder);
router.put("/:id/update-and-recreate-lots", updateProductStatus, updatePurchaseOrderAndRecreateLots);
router.delete("/:id",deletePurchaseOrder);

// Routes สำหรับตรวจสอบและเติมสต็อกอัตโนมัติ
router.post("/auto-add-stock/:productId", updateProductStatus, autoAddStock);
router.post("/auto-add-stock-all", updateProductStatus, autoAddStockAll);

// Routes สำหรับเติมสต็อกใหม่
router.post("/:id/add-all-stock", updateProductStatus, addAllStockFromOrder);
router.post("/auto-add-stock-zero", updateProductStatus, autoAddStockForAllZeroStock);

module.exports = router;




