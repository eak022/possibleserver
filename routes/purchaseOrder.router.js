const express = require("express");
const router = express.Router();
const {createPurchaseOrder, getAllPurchaseOrders , getPurchaseOrderById, updatePurchaseOrder, deletePurchaseOrder, updateStockFromPurchaseOrder } = require("../controllers/purchaseOrder.controller");

router.post("/createPurchaseOrder",createPurchaseOrder);
router.get("/getAllPurchaseOrders",getAllPurchaseOrders);
router.get("/getPurchaseOrderById",getPurchaseOrderById);
router.put("/updatePurchaseOrder",updatePurchaseOrder);
router.delete("/deletePurchaseOrder",deletePurchaseOrder);
router.put("/updateStockFromPurchaseOrder",updateStockFromPurchaseOrder);

module.exports = router;
