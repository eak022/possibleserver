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
  getSalesReportByLots,
  checkStripePaymentOrder // ✅ เพิ่ม import
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

// ✅ เพิ่ม route สำหรับตรวจสอบ Order จาก Stripe Payment Intent
router.get("/check-stripe-payment/:paymentIntentId", checkStripePaymentOrder);

module.exports = router;