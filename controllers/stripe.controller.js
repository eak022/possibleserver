const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const PaymentService = require('../services/payment.service');

// สร้าง Stripe Checkout Session สำหรับการชำระเงิน
const createPaymentIntent = async (req, res) => {
  try {
    const { amount, currency = 'thb', orderId, description, orderData } = req.body;

    // Validation
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'จำนวนเงินต้องมากกว่า 0'
      });
    }

    if (amount > 1000000) { // จำกัดจำนวนเงินไม่เกิน 1 ล้านบาท
      return res.status(400).json({
        success: false,
        message: 'จำนวนเงินต้องไม่เกิน 1,000,000 บาท'
      });
    }

    if (currency !== 'thb') {
      return res.status(400).json({
        success: false,
        message: 'รองรับเฉพาะสกุลเงินบาท (THB)'
      });
    }

    // ตรวจสอบ Stripe configuration
    if (!process.env.STRIPE_SECRET_KEY) {
      console.error('STRIPE_SECRET_KEY ไม่ได้ตั้งค่า');
      return res.status(500).json({
        success: false,
        message: 'ระบบการชำระเงินยังไม่พร้อมใช้งาน'
      });
    }

    // สร้าง Stripe Checkout Session สำหรับ PromptPay เท่านั้น
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['promptpay'], // เฉพาะ PromptPay เท่านั้น
      line_items: [{
        price_data: {
          currency: currency,
          product_data: {
            name: description || 'การชำระเงินสินค้า',
            description: `Order #${orderId}`
          },
          unit_amount: Math.round(amount * 100) // แปลงเป็นสตางค์
        },
        quantity: 1
      }],
      mode: 'payment',
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/cancel`,
      metadata: {
        orderId: orderId || 'unknown',
        description: description || 'การชำระเงิน'
      }
    });

    // ถ้ามี orderData ให้สร้าง Order ใหม่
    let order = null;
    if (orderData) {
      order = await PaymentService.createOrderWithStripePayment(
        orderData,
        session.id,
        session.url
      );
    }

    res.status(200).json({
      success: true,
      data: {
        sessionId: session.id,
        checkoutUrl: session.url,
        amount: amount,
        currency: currency,
        order: order
      },
      message: 'สร้างการชำระเงินสำเร็จ'
    });

  } catch (error) {
    console.error('Stripe Checkout Session Error:', error);
    
    // จัดการ error ที่เฉพาะเจาะจง
    if (error.type === 'StripeCardError') {
      return res.status(400).json({
        success: false,
        message: 'เกิดข้อผิดพลาดในการชำระเงิน: ' + error.message
      });
    } else if (error.type === 'StripeInvalidRequestError') {
      return res.status(400).json({
        success: false,
        message: 'ข้อมูลไม่ถูกต้อง: ' + error.message
      });
    } else if (error.type === 'StripeAPIError') {
      return res.status(400).json({
        success: false,
        message: 'เกิดข้อผิดพลาดที่ Stripe API: ' + error.message
      });
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return res.status(500).json({
        success: false,
        message: 'ไม่สามารถเชื่อมต่อกับ Stripe ได้ กรุณาลองใหม่อีกครั้ง'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการสร้างการชำระเงิน',
      error: error.message
    });
  }
};



// ตรวจสอบสถานะการชำระเงินจาก Checkout Session
const checkSessionStatus = async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'ต้องระบุ Session ID'
      });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    res.status(200).json({
      success: true,
      data: {
        sessionId: session.id,
        status: session.payment_status,
        amount: session.amount_total / 100,
        currency: session.currency,
        created: session.created,
        metadata: session.metadata
      },
      message: 'ตรวจสอบสถานะการชำระเงินสำเร็จ'
    });

  } catch (error) {
    console.error('Check Session Status Error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการตรวจสอบสถานะการชำระเงิน',
      error: error.message
    });
  }
};

// ยกเลิกการชำระเงิน
const cancelPayment = async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'ต้องระบุ Session ID'
      });
    }

    // Expire the checkout session
    const session = await stripe.checkout.sessions.expire(sessionId);

    res.status(200).json({
      success: true,
      data: {
        sessionId: session.id,
        status: session.status,
        expiredAt: new Date()
      },
      message: 'ยกเลิกการชำระเงินสำเร็จ'
    });

  } catch (error) {
    console.error('Cancel Payment Error:', error);
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการยกเลิกการชำระเงิน',
      error: error.message
    });
  }
};

// Webhook สำหรับรับการอัปเดตจาก Stripe
const handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handlePaymentSuccess(event.data.object);
        break;
      
      case 'checkout.session.expired':
        await handlePaymentExpired(event.data.object);
        break;
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
};

// จัดการการชำระเงินสำเร็จ
const handlePaymentSuccess = async (session) => {
  try {
    console.log('Payment succeeded:', session.id);
    await PaymentService.handleSuccessfulPayment(session);
  } catch (error) {
    console.error('Handle payment success error:', error);
  }
};

// จัดการการชำระเงินหมดอายุ
const handlePaymentExpired = async (session) => {
  try {
    console.log('Payment expired:', session.id);
    await PaymentService.handleCanceledPayment(session);
  } catch (error) {
    console.error('Handle payment expired error:', error);
  }
};

module.exports = {
  createPaymentIntent,
  checkSessionStatus,
  cancelPayment,
  handleWebhook
};
