const express = require("express");
const router = express.Router();
const { 
  createOrder, 
  getOrders, 
  getOrderById, 
  deleteOrder,  
  updateOrderDetail, 
  updateOrderStatus, 
  createDisposeOrder,
  getOrderLotDetails,
  getSalesReportByLots
} = require("../controllers/order.controller");

router.post("/", createOrder); 
router.get("/", getOrders); 
router.get("/:id", getOrderById);
router.get("/:id/lots", getOrderLotDetails); // ✅ ดูข้อมูลล็อตใน order
router.get("/report/lots", getSalesReportByLots); // ✅ รายงานการขายตามล็อต
router.delete("/:id", deleteOrder);
router.put("/:id", updateOrderDetail);
router.patch("/:id/status", updateOrderStatus);
router.post("/dispose", createDisposeOrder);

module.exports = router;