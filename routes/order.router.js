const express = require("express");
const router = express.Router();
const { createOrder, getOrders, getOrderById, deleteOrder,  updateOrderDetail, updateOrderStatus } = require("../controllers/order.controller");

router.post("/", createOrder); 
router.get("/", getOrders); 
router.get("/:id", getOrderById);
router.delete("/:id", deleteOrder);
router.put("/:id", updateOrderDetail);
router.patch("/:id/status", updateOrderStatus);

module.exports = router;