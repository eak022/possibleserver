const express = require("express");
const router = express.Router();
const {receiveStock, createPurchaseOrder, getAllPurchaseOrders, updatePurchaseOrder, deletePurchaseOrder} = require("../controllers/purchaseOrder.controller");

router.post("/",createPurchaseOrder);
router.post("/:id/receive",receiveStock);
router.get("/",getAllPurchaseOrders);
router.put("/:id",updatePurchaseOrder);
router.delete("/:id",deletePurchaseOrder);


module.exports = router;




