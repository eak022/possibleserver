const express = require('express');
const router = express.Router();
const stripeController = require('../controllers/stripe.controller');

// สร้างการชำระเงินใหม่ (ต้อง login)
router.post('/create-payment-intent', stripeController.createPaymentIntent);

// ตรวจสอบสถานะการชำระเงินจาก Payment Link (ต้อง login)
router.get('/payment-status/:paymentLinkId', stripeController.checkPaymentStatus);

// ยกเลิกการชำระเงิน (ต้อง login)
router.post('/cancel-payment/:paymentLinkId', stripeController.cancelPayment);

// Webhook is mounted at app-level in `index.js` before body parsers to preserve raw body

module.exports = router;
