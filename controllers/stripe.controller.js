const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const PaymentService = require('../services/payment.service');

// สร้าง Stripe Payment Intent สำหรับ PromptPay โดยตรง
const createPaymentIntent = async (req, res) => {
  try {
    const { amount, currency = 'thb', orderId, description, orderData } = req.body;

    // Validation
    if (!amount || amount <= 0) { // ตรวจสอบว่ามีจำนวนเงินและไม่ติดลบ
      return res.status(400).json({
        success: false,
        message: 'จำนวนเงินต้องมากกว่า 0'
      });
    }

    // ตรวจสอบขั้นต่ำสำหรับ QR Code (PromptPay)
    if (amount < 10) {
      return res.status(400).json({
        success: false,
        message: 'QR Code ต้องมียอดขั้นต่ำ 10 บาท'
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

    // สร้าง Stripe Payment Intent สำหรับ PromptPay โดยตรง
    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: currency,
        payment_method_types: ['promptpay'],
        metadata: { 
          orderId: orderId, 
          description: description, 
          amount: amount, 
          currency: currency 
        }
      });
    } catch (stripeError) {
      console.error('Stripe API Error:', stripeError);
      
      // จัดการ error เฉพาะของ Stripe
      if (stripeError.type === 'StripeInvalidRequestError') {
        if (stripeError.message.includes('Amount must be no less than') || 
            stripeError.message.includes('Amount must be at least')) {
          return res.status(400).json({
            success: false,
            message: 'QR Code ต้องมียอดขั้นต่ำ 10 บาท'
          });
        }
      }
      
      return res.status(500).json({
        success: false,
        message: 'เกิดข้อผิดพลาดในการสร้างการชำระเงิน กรุณาลองใหม่อีกครั้ง'
      });
    }

    const promptPayDisplayUrl = `https://promptpay.io/${process.env.PROMPTPAY_MERCHANT_ID || '8710776015604'}/${amount}`;

    // ✅ สร้าง Order ใหม่พร้อมตัดสต็อกทันที
    let order = null;
    if (orderData) {
      try {
        order = await PaymentService.createOrderWithStripePayment(
          orderData,
          paymentIntent.id,
          promptPayDisplayUrl
        );
        console.log('Order created successfully with stock reduction:', order._id);
      } catch (orderError) {
        console.error('Error creating order:', orderError);
        
        // ถ้าสร้างออร์เดอร์ไม่สำเร็จ ให้ยกเลิก payment intent
        try {
          await stripe.paymentIntents.cancel(paymentIntent.id);
          console.log('Payment intent canceled due to order creation failure');
        } catch (cancelError) {
          console.error('Error canceling payment intent:', cancelError);
        }
        
        return res.status(500).json({
          success: false,
          message: orderError.message || 'เกิดข้อผิดพลาดในการสร้างออร์เดอร์ กรุณาลองใหม่อีกครั้ง'
        });
      }
    }

    // สร้าง QR Code URL สำหรับ PromptPay โดยตรง
    // ใช้ Stripe PromptPay QR Code API
    const qrCodeUrl = `https://api.stripe.com/v1/payment_intents/${paymentIntent.id}/confirm`;
    
    // สร้าง PromptPay QR Code URL ที่สามารถสแกนได้ทันที
    // ใช้ format มาตรฐาน PromptPay: promptpay://merchantId/amount
    const promptPayQRUrl = `promptpay://${process.env.PROMPTPAY_MERCHANT_ID || '8710776015604'}/${amount}`;
    
    // หรือใช้ URL สำหรับแสดง QR Code ในหน้าเว็บ
    // const promptPayDisplayUrl = `https://promptpay.io/${process.env.PROMPTPAY_MERCHANT_ID || '8710776015604'}/${amount}`;

    res.status(200).json({
      success: true,
      data: {
        paymentIntentId: paymentIntent.id,
        qrCodeUrl: promptPayDisplayUrl, // URL สำหรับแสดง QR Code ในหน้าเว็บ
        promptPayUrl: promptPayDisplayUrl, // URL สำหรับ PromptPay app
        stripePaymentIntentUrl: promptPayDisplayUrl, // URL สำหรับ Stripe API
        amount: amount,
        currency: currency,
        status: paymentIntent.status,
        merchantId: process.env.PROMPTPAY_MERCHANT_ID || '8710776015604',
        order: order
      },
      message: 'สร้างการชำระเงินสำเร็จ'
    });

  } catch (error) {
    console.error('Stripe Payment Intent Error:', error);
    
    // จัดการ error ที่เฉพาะเจาะจง
    if (error.type === 'StripeCardError') {
      return res.status(400).json({
        success: false,
        message: 'เกิดข้อผิดพลาดในการชำระเงิน: ' + error.message
      });
    } else if (error.type === 'StripeInvalidRequestError') {
      // ตรวจสอบ error message ที่เฉพาะเจาะจง
      let errorMessage = 'ข้อมูลไม่ถูกต้อง';
      
      if (error.message.includes('Amount must be no less than')) {
        errorMessage = 'QR Code ต้องมียอดขั้นต่ำ 10 บาท';
      } else if (error.message.includes('Amount must be at least')) {
        errorMessage = 'QR Code ต้องมียอดขั้นต่ำ 10 บาท';
      } else if (error.message.includes('amount')) {
        errorMessage = 'ข้อมูลจำนวนเงินไม่ถูกต้อง';
      } else {
        errorMessage = 'ข้อมูลไม่ถูกต้อง: ' + error.message;
      }
      
      return res.status(400).json({
        success: false,
        message: errorMessage
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
    } else if (error.type === 'StripeAuthenticationError') {
      return res.status(500).json({
        success: false,
        message: 'เกิดข้อผิดพลาดในการยืนยันตัวตนกับ Stripe กรุณาตรวจสอบ API Key'
      });
    } else if (error.type === 'StripePermissionError') {
      return res.status(500).json({
        success: false,
        message: 'ไม่มีสิทธิ์ในการดำเนินการนี้ กรุณาตรวจสอบการตั้งค่า Stripe'
      });
    } else if (error.type === 'StripeRateLimitError') {
      return res.status(429).json({
        success: false,
        message: 'เกินขีดจำกัดการเรียกใช้ API กรุณาลองใหม่อีกครั้งในภายหลัง'
      });
    }
    
    // Log detailed error information
    console.error('Detailed Stripe Error:', {
      type: error.type,
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      requestId: error.requestId,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({
      success: false,
      message: 'เกิดข้อผิดพลาดในการสร้างการชำระเงิน',
      error: error.message,
      errorType: error.type || 'Unknown',
      timestamp: new Date().toISOString()
    });
  }
};



// ตรวจสอบสถานะการชำระเงินจาก Payment Intent
const checkPaymentStatus = async (req, res) => {
  try {
    const { paymentIntentId } = req.params;

    if (!paymentIntentId) {
      return res.status(400).json({
        success: false,
        message: 'ต้องระบุ Payment Intent ID'
      });
    }

    // ดึงข้อมูล Payment Intent จาก Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    // ดึงข้อมูลการชำระเงินจาก Payment Intent
    let paymentStatus = 'pending';
    
    if (paymentIntent.status === 'succeeded') {
      paymentStatus = 'paid';
    } else if (paymentIntent.status === 'processing') {
      paymentStatus = 'processing';
    } else if (paymentIntent.status === 'requires_payment_method') {
      paymentStatus = 'unpaid';
    } else if (paymentIntent.status === 'canceled') {
      paymentStatus = 'expired';
    } else if (paymentIntent.status === 'requires_action') {
      paymentStatus = 'pending';
    }

    // ดึงข้อมูล amount และ currency
    const amount = paymentIntent.amount / 100;
    const currency = paymentIntent.currency;

    res.status(200).json({
      success: true,
      data: {
        paymentIntentId: paymentIntent.id,
        status: paymentStatus,
        amount: amount,
        currency: currency,
        created: paymentIntent.created,
        metadata: paymentIntent.metadata,
        paymentIntent: {
          id: paymentIntent.id,
          status: paymentIntent.status,
          amount: amount,
          payment_method_types: paymentIntent.payment_method_types
        }
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
    const { paymentIntentId } = req.params;

    if (!paymentIntentId) {
      return res.status(400).json({
        success: false,
        message: 'ต้องระบุ Payment Intent ID'
      });
    }

    // ยกเลิก Payment Intent
    const paymentIntent = await stripe.paymentIntents.cancel(paymentIntentId);

    res.status(200).json({
      success: true,
      data: {
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        canceledAt: new Date().toISOString()
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

  // Debug logging
  console.log('Webhook handler called with:', {
    hasSignature: !!sig,
    signatureLength: sig ? sig.length : 0,
    hasBody: !!req.body,
    bodyType: typeof req.body,
    bodyLength: req.body ? req.body.length : 0,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ? 'set' : 'not set'
  });

  // Validate webhook secret
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET is not set');
    return res.status(500).send('Webhook secret not configured');
  }

  // Validate signature header
  if (!sig) {
    console.error('No Stripe signature found in headers');
    return res.status(400).send('No signature found');
  }

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log('Webhook signature verified successfully for event:', event.type);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    console.error('Error details:', {
      errorType: err.type,
      errorCode: err.code,
      errorMessage: err.message
    });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // ใช้ Set เพื่อป้องกันการประมวลผล events ซ้ำ
    const processedEvents = new Set();
    
    switch (event.type) {
      case 'payment_intent.succeeded':
        console.log('Processing payment_intent.succeeded event');
        if (!processedEvents.has(event.data.object.id)) {
          await handlePaymentSuccess(event.data.object);
          processedEvents.add(event.data.object.id);
        }
        break;
      
      case 'payment_intent.payment_failed':
        console.log('Processing payment_intent.payment_failed event');
        if (!processedEvents.has(event.data.object.id)) {
          await handlePaymentFailure(event.data.object);
          processedEvents.add(event.data.object.id);
        }
        break;
      
      case 'payment_intent.canceled':
        console.log('Processing payment_intent.canceled event');
        if (!processedEvents.has(event.data.object.id)) {
          await handlePaymentCancel(event.data.object);
          processedEvents.add(event.data.object.id);
        }
        break;
      
      case 'payment_intent.created':
        console.log('Processing payment_intent.created event');
        if (!processedEvents.has(event.data.object.id)) {
          await handlePaymentIntentCreated(event.data.object);
          processedEvents.add(event.data.object.id);
        }
        break;
      
      case 'checkout.session.completed':
        console.log('Processing checkout.session.completed event');
        if (!processedEvents.has(event.data.object.id)) {
          await handleCheckoutSessionCompleted(event.data.object);
          processedEvents.add(event.data.object.id);
        }
        break;
      
      case 'checkout.session.expired':
        console.log('Processing checkout.session.expired event');
        if (!processedEvents.has(event.data.object.id)) {
          await handleCheckoutSessionExpired(event.data.object);
          processedEvents.add(event.data.object.id);
        }
        break;
      
      case 'charge.succeeded':
        console.log('Processing charge.succeeded event');
        if (!processedEvents.has(event.data.object.id)) {
          await handleChargeSucceeded(event.data.object);
          processedEvents.add(event.data.object.id);
        }
        break;
      
      case 'charge.updated':
        console.log('Processing charge.updated event');
        if (!processedEvents.has(event.data.object.id)) {
          await handleChargeUpdated(event.data.object);
          processedEvents.add(event.data.object.id);
        }
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
    
    // ตรวจสอบว่า payment intent นี้ยังไม่ถูกประมวลผล
    if (paymentIntent.status === 'succeeded') {
      await PaymentService.handleSuccessfulPayment(paymentIntent);
      console.log('Payment success processed successfully for:', paymentIntent.id);
    } else {
      console.log('Payment intent not succeeded, skipping:', paymentIntent.status);
    }
  } catch (error) {
    console.error('Handle payment success error:', error);
  }
};

// จัดการการชำระเงินล้มเหลว
const handlePaymentFailure = async (paymentIntent) => {
  try {
    console.log('Payment failed:', paymentIntent.id);
    
    if (paymentIntent.status === 'requires_payment_method' || paymentIntent.status === 'canceled') {
      await PaymentService.handleFailedPayment(paymentIntent);
      console.log('Payment failure processed successfully for:', paymentIntent.id);
    } else {
      console.log('Payment intent not failed, skipping:', paymentIntent.status);
    }
  } catch (error) {
    console.error('Handle payment failure error:', error);
  }
};

// จัดการการยกเลิกการชำระเงิน
const handlePaymentCancel = async (paymentIntent) => {
  try {
    console.log('Payment canceled:', paymentIntent.id);
    
    if (paymentIntent.status === 'canceled') {
      await PaymentService.handleCanceledPayment(paymentIntent);
      console.log('Payment cancel processed successfully for:', paymentIntent.id);
    } else {
      console.log('Payment intent not canceled, skipping:', paymentIntent.status);
    }
  } catch (error) {
    console.error('Handle payment cancel error:', error);
  }
};

// จัดการ checkout session completed
const handleCheckoutSessionCompleted = async (session) => {
  try {
    console.log('Checkout session completed:', session.id);
    if (session.payment_intent) {
      const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
      await PaymentService.handleSuccessfulPayment(paymentIntent);
    }
  } catch (error) {
    console.error('Handle checkout session completed error:', error);
  }
};

// จัดการ checkout session expired
const handleCheckoutSessionExpired = async (session) => {
  try {
    console.log('Checkout session expired:', session.id);
    // สามารถเพิ่มการจัดการ session ที่หมดอายุได้ที่นี่
  } catch (error) {
    console.error('Handle checkout session expired error:', error);
  }
};

// จัดการ payment intent created
const handlePaymentIntentCreated = async (paymentIntent) => {
  try {
    console.log('Payment intent created:', paymentIntent.id);
    // สามารถเพิ่มการจัดการ payment intent ที่สร้างใหม่ได้ที่นี่
  } catch (error) {
    console.error('Handle payment intent created error:', error);
  }
};

// จัดการ charge succeeded
const handleChargeSucceeded = async (charge) => {
  try {
    console.log('Charge succeeded:', charge.id);
    
    // ตรวจสอบว่า charge นี้เกี่ยวข้องกับ payment intent หรือไม่
    if (charge.payment_intent) {
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(charge.payment_intent);
        console.log('Payment intent found for charge:', paymentIntent.id, 'Status:', paymentIntent.status);
        
        // ตรวจสอบว่า payment intent นี้ยังไม่ถูกประมวลผล
        if (paymentIntent.status === 'succeeded') {
          await PaymentService.handleSuccessfulPayment(paymentIntent);
        } else {
          console.log('Payment intent not yet succeeded, skipping:', paymentIntent.status);
        }
      } catch (retrieveError) {
        if (retrieveError.code === 'resource_missing') {
          console.log('Payment intent not found for charge, may have been deleted:', charge.payment_intent);
        } else {
          console.error('Error retrieving payment intent:', retrieveError.message);
        }
      }
    } else {
      console.log('Charge has no associated payment intent');
    }
  } catch (error) {
    console.error('Handle charge succeeded error:', error);
  }
};

// จัดการ charge updated
const handleChargeUpdated = async (charge) => {
  try {
    console.log('Charge updated:', charge.id);
    // สามารถเพิ่มการจัดการ charge ที่อัปเดตได้ที่นี่
  } catch (error) {
    console.error('Handle charge updated error:', error);
  }
};

module.exports = {
  createPaymentIntent,
  checkPaymentStatus,
  cancelPayment,
  handleWebhook
};
