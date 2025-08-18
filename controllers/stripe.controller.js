const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const PaymentService = require('../services/payment.service');

// สร้าง Stripe Payment Link สำหรับ PromptPay
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

    // สร้าง Stripe Payment Link สำหรับ PromptPay
    const paymentLink = await stripe.paymentLinks.create({
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
      payment_method_types: ['promptpay'], // เฉพาะ PromptPay เท่านั้น
      after_completion: {
        type: 'redirect',
        redirect: {
          url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment/success?session_id={CHECKOUT_SESSION_ID}`
        }
      },
      metadata: {
        orderId: orderId || 'unknown',
        description: description || 'การชำระเงิน'
      }
    });

    // อัปเดต metadata ของ payment link ให้มี payment_link_id
    await stripe.paymentLinks.update(paymentLink.id, {
      metadata: {
        ...paymentLink.metadata,
        payment_link_id: paymentLink.id
      }
    });

    // ถ้ามี orderData ให้สร้าง Order ใหม่
    let order = null;
    if (orderData) {
      order = await PaymentService.createOrderWithStripePayment(
        orderData,
        paymentLink.id, // ใช้ paymentLink.id แทน sessionId
        paymentLink.url
      );
    }

    res.status(200).json({
      success: true,
      data: {
        paymentLinkId: paymentLink.id,
        qrCodeUrl: paymentLink.url, // URL ที่มี QR Code ของ Stripe โดยตรง
        amount: amount,
        currency: currency,
        order: order
      },
      message: 'สร้างการชำระเงินสำเร็จ'
    });

  } catch (error) {
    console.error('Stripe Payment Link Error:', error);
    
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



// ตรวจสอบสถานะการชำระเงินจาก Payment Link
const checkPaymentStatus = async (req, res) => {
  try {
    const { paymentLinkId } = req.params;

    if (!paymentLinkId) {
      return res.status(400).json({
        success: false,
        message: 'ต้องระบุ Payment Link ID'
      });
    }

    const paymentLink = await stripe.paymentLinks.retrieve(paymentLinkId);
    
    // ดึงข้อมูลการชำระเงินจาก Payment Link
    let paymentStatus = 'pending';
    let paymentIntent = null;
    
    if (paymentLink.active) {
      try {
        // ใช้ checkout sessions แทน payment intents เพื่อตรวจสอบสถานะ
        const sessions = await stripe.checkout.sessions.list({
          limit: 100,
          payment_link: paymentLinkId
        });
        
        if (sessions.data.length > 0) {
          const session = sessions.data[0];
          if (session.payment_intent) {
            paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
            paymentStatus = paymentIntent.status === 'succeeded' ? 'paid' : 
                          paymentIntent.status === 'processing' ? 'processing' : 'unpaid';
          } else if (session.payment_status === 'paid') {
            paymentStatus = 'paid';
          }
        }
      } catch (listError) {
        console.log('ไม่สามารถดึง checkout sessions ได้:', listError.message);
        // ถ้าไม่สามารถดึง checkout sessions ได้ ให้ใช้วิธีเดิม
        const payments = await stripe.paymentIntents.list({
          limit: 100
        });
        
        // กรอง payment intents ที่เกี่ยวข้องกับ payment link นี้
        const relatedPayments = payments.data.filter(payment => 
          payment.metadata && payment.metadata.payment_link_id === paymentLinkId
        );
        
        if (relatedPayments.length > 0) {
          paymentIntent = relatedPayments[0];
          paymentStatus = paymentIntent.status === 'succeeded' ? 'paid' : 'unpaid';
        }
      }
    } else {
      paymentStatus = 'expired';
    }

    res.status(200).json({
      success: true,
      data: {
        paymentLinkId: paymentLink.id,
        status: paymentStatus,
        amount: paymentLink.line_items.data[0].price_data.unit_amount / 100,
        currency: paymentLink.line_items.data[0].price_data.currency,
        created: paymentLink.created,
        metadata: paymentLink.metadata,
        paymentIntent: paymentIntent ? {
          id: paymentIntent.id,
          status: paymentIntent.status,
          amount: paymentIntent.amount / 100
        } : null
      },
      message: 'ตรวจสอบสถานะการชำระเงินสำเร็จ'
    });

  } catch (error) {
    console.error('Check Payment Status Error:', error);
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
    const { paymentLinkId } = req.params;

    if (!paymentLinkId) {
      return res.status(400).json({
        success: false,
        message: 'ต้องระบุ Payment Link ID'
      });
    }

    // Deactivate the payment link
    const paymentLink = await stripe.paymentLinks.update(paymentLinkId, {
      active: false
    });

    res.status(200).json({
      success: true,
      data: {
        paymentLinkId: paymentLink.id,
        status: 'expired',
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
      case 'payment_intent.succeeded':
        await handlePaymentSuccess(event.data.object);
        break;
      
      case 'payment_intent.payment_failed':
        await handlePaymentFailure(event.data.object);
        break;
      
      case 'payment_intent.canceled':
        await handlePaymentCancel(event.data.object);
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
const handlePaymentSuccess = async (paymentIntent) => {
  try {
    console.log('Payment succeeded:', paymentIntent.id);
    await PaymentService.handleSuccessfulPayment(paymentIntent);
  } catch (error) {
    console.error('Handle payment success error:', error);
  }
};

// จัดการการชำระเงินล้มเหลว
const handlePaymentFailure = async (paymentIntent) => {
  try {
    console.log('Payment failed:', paymentIntent.id);
    await PaymentService.handleFailedPayment(paymentIntent);
  } catch (error) {
    console.error('Handle payment failure error:', error);
  }
};

// จัดการการยกเลิกการชำระเงิน
const handlePaymentCancel = async (paymentIntent) => {
  try {
    console.log('Payment canceled:', paymentIntent.id);
    await PaymentService.handleCanceledPayment(paymentIntent);
  } catch (error) {
    console.error('Handle payment cancel error:', error);
  }
};

module.exports = {
  createPaymentIntent,
  checkPaymentStatus,
  cancelPayment,
  handleWebhook
};
