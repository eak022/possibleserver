const express = require("express");
const router = express.Router();
const {
  receiveStock, 
  createPurchaseOrder, 
  getPurchaseOrderById, 
  getAllPurchaseOrders, 
  updatePurchaseOrder, 
  deletePurchaseOrder,
  autoAddStock,
  autoAddStockAll,
  addAllStockFromOrder,
  autoAddStockForAllZeroStock
} = require("../controllers/purchaseOrder.controller");

router.post("/",createPurchaseOrder);
router.post("/:id/receive",receiveStock);
router.get("/",getAllPurchaseOrders);
router.get("/:id",getPurchaseOrderById);
router.put("/:id",updatePurchaseOrder);
router.delete("/:id",deletePurchaseOrder);

// Routes สำหรับตรวจสอบและเติมสต็อกอัตโนมัติ
router.post("/auto-add-stock/:productId", autoAddStock);
router.post("/auto-add-stock-all", autoAddStockAll);

// Routes สำหรับเติมสต็อกใหม่
router.post("/:id/add-all-stock", addAllStockFromOrder);
router.post("/auto-add-stock-zero", autoAddStockForAllZeroStock);

module.exports = router;




