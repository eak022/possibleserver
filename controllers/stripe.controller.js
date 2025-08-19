const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const PaymentService = require('../services/payment.service');

// สร้าง Stripe Payment Intent สำหรับ PromptPay โดยตรง
const createPaymentIntent = async (req, res) => {
  try {
    const { amount, currency = 'thb', orderId, description, orderData } = req.body;

    // Validation - ปรับเพดานตาม PromptPay บน Stripe
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'จำนวนเงินต้องมากกว่า 0'
      });
    }

    // ตรวจสอบขั้นต่ำสำหรับ QR Code (PromptPay) - ปรับเป็น 10 บาท
    if (amount < 10) {
      return res.status(400).json({
        success: false,
        message: 'PromptPay ต้องมียอดขั้นต่ำ 10 บาท'
      });
    }

    // ปรับเพดานสูงสุดจาก 1,000,000 เป็น 150,000 ตาม PromptPay บน Stripe
    if (amount > 150000) {
      return res.status(400).json({
        success: false,
        message: 'PromptPay รับได้ไม่เกิน 150,000 บาทต่อครั้ง'
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

    // 1) สร้าง PaymentIntent
    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // แปลงเป็นสตางค์
        currency: currency,
        payment_method_types: ['promptpay'], // เฉพาะ PromptPay เท่านั้น
        metadata: {
          orderId: orderId || 'unknown',
          description: description || 'การชำระเงิน',
          amount: amount.toString(),
          currency: currency,
          createdAt: new Date().toISOString()
        }
        // ลบ payment_method_options ออกเพราะไม่รองรับใน PromptPay
      });

      console.log('Stripe Payment Intent created:', {
        id: paymentIntent.id,
        amount: amount,
        currency: currency,
        status: paymentIntent.status,
        metadata: paymentIntent.metadata
      });
    } catch (stripeError) {
      // จัดการ Stripe error โดยเฉพาะ
      console.error('Stripe Payment Intent creation failed:', stripeError);
      
      if (stripeError.type === 'StripeInvalidRequestError') {
        let errorMessage = 'ข้อมูลไม่ถูกต้อง';
        
        if (stripeError.message.includes('Amount must be no less than')) {
          errorMessage = 'PromptPay ต้องมียอดขั้นต่ำ 10 บาท';
        } else if (stripeError.message.includes('Amount must be at least')) {
          errorMessage = 'PromptPay ต้องมียอดขั้นต่ำ 10 บาท';
        } else if (stripeError.message.includes('amount')) {
          errorMessage = 'ข้อมูลจำนวนเงินไม่ถูกต้อง';
        } else {
          errorMessage = 'ข้อมูลไม่ถูกต้อง: ' + stripeError.message;
        }
        
        return res.status(400).json({
          success: false,
          message: errorMessage
        });
      }
      
      // ถ้าเป็น error อื่นๆ ให้ throw ต่อไป
      throw stripeError;
    }

    // 2) ยืนยันให้เป็น PromptPay และให้ Stripe สร้าง QR
    let confirmed;
    try {
      confirmed = await stripe.paymentIntents.confirm(paymentIntent.id, {
        payment_method_data: { 
          type: 'promptpay',
          billing_details: {
            email: process.env.DEFAULT_BILLING_EMAIL || '654259022@webmail.npru.ac.th'
          }
        },
        return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/payment-success`,
      });

      console.log('Payment Intent confirmed for PromptPay:', {
        id: confirmed.id,
        status: confirmed.status,
        nextAction: confirmed.next_action
      });
    } catch (confirmError) {
      console.error('Failed to confirm Payment Intent:', confirmError);
      
      // ถ้า confirm ไม่สำเร็จ ให้ลองใช้ Payment Intent ที่สร้างไว้แล้ว
      console.log('Falling back to original Payment Intent');
      confirmed = paymentIntent;
    }

    // 3) ดึง URL QR ของ Stripe จาก next_action
    const qrAction = confirmed.next_action?.promptpay_display_qr_code;
    
    if (!qrAction) {
      console.error('No QR code action found in confirmed payment intent');
      return res.status(500).json({
        success: false,
        message: 'ไม่สามารถสร้าง QR Code ได้ กรุณาลองใหม่อีกครั้ง'
      });
    }

    // ใช้ QR ของ Stripe เท่านั้น - ไม่ใช้ fallback
    const qrCodeUrl = qrAction.image_url_png || qrAction.image_url_svg;
    const promptPayUrl = qrAction.hosted_instructions_url;
    
    if (!qrCodeUrl) {
      console.error('No QR image URL found in Stripe response');
      return res.status(500).json({
        success: false,
        message: 'ไม่สามารถสร้าง QR Code ได้ กรุณาลองใหม่อีกครั้ง'
      });
    }
    
    console.log('QR Code generated by Stripe:', {
      png: qrAction.image_url_png,
      svg: qrAction.image_url_svg,
      hosted: qrAction.hosted_instructions_url
    });

    // ไม่สร้าง order ตอนนี้ - รอให้ชำระเงินสำเร็จก่อน
    let order = null;
    let finalOrderId = orderId;
    
    // เก็บข้อมูลตะกร้าใน metadata เพื่อใช้สร้าง order ภายหลัง
    const cartData = {
      cartItems: req.body.cartItems || [],
      userName: req.body.userName || 'Guest',
      totalAmount: amount
    };
    
    // อัปเดต metadata ของ PaymentIntent ด้วยข้อมูลตะกร้า
    try {
      await stripe.paymentIntents.update(confirmed.id, {
        metadata: {
          ...paymentIntent.metadata,
          cartData: JSON.stringify(cartData),
          userName: req.body.userName || 'Guest'
        }
      });
      console.log('Updated PaymentIntent metadata with cart data for user:', req.body.userName);
    } catch (updateError) {
      console.error('Failed to update PaymentIntent metadata:', updateError);
    }

    res.status(200).json({
      success: true,
      data: {
        paymentIntentId: confirmed.id,
        qrCodeUrl: qrCodeUrl, // URL รูป QR ของ Stripe (PNG/SVG)
        promptPayUrl: promptPayUrl, // URL สำหรับ PromptPay app
        amount: amount,
        currency: currency,
        status: confirmed.status
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
        errorMessage = 'PromptPay ต้องมียอดขั้นต่ำ 10 บาท';
      } else if (error.message.includes('Amount must be at least')) {
        errorMessage = 'PromptPay ต้องมียอดขั้นต่ำ 10 บาท';
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

// เพิ่ม Set สำหรับเก็บ event IDs ที่ประมวลผลแล้ว (เก็บใน memory)
const processedEventIds = new Set();

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
      req.body, // raw Buffer จาก express.raw()
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    console.log('Webhook signature verified successfully for event:', event.type);
    console.log('Event data:', {
      id: event.id,
      type: event.type,
      object: event.data?.object?.id,
      status: event.data?.object?.status
    });
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    console.error('Error details:', {
      errorType: err.type,
      errorCode: err.code,
      errorMessage: err.message
    });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // กันซ้ำด้วย event.id
  if (processedEventIds.has(event.id)) {
    console.log('Event already processed, skipping:', event.id);
    return res.json({ received: true });
  }

  try {
    console.log('🔄 Processing webhook event:', {
      type: event.type,
      id: event.id,
      objectId: event.data?.object?.id,
      objectType: event.data?.object?.object,
      timestamp: new Date().toISOString()
    });

    switch (event.type) {
      case 'payment_intent.succeeded':
        console.log('Processing payment_intent.succeeded event');
        // ✅ เพิ่มการตรวจสอบว่า event นี้ถูกประมวลผลแล้วหรือไม่
        if (event.data?.object?.metadata?.processed === 'true') {
          console.log('Payment intent already processed, skipping webhook:', event.data.object.id);
          break;
        }
        await handlePaymentSuccess(event.data.object);
        break;
      
      case 'payment_intent.payment_failed':
        console.log('Processing payment_intent.payment_failed event');
        // ✅ เพิ่มการจัดการ payment_intent.payment_failed
        await handlePaymentFailure(event.data.object);
        break;
      
      case 'payment_intent.canceled':
        console.log('Processing payment_intent.canceled event');
        await handlePaymentCancel(event.data.object);
        break;
      
      case 'payment_intent.created':
        console.log('Processing payment_intent.created event');
        // ❌ ไม่ต้องทำอะไรกับ payment_intent.created เพราะไม่ต้องการสร้าง Order ตอนนี้
        console.log('Payment intent created - no action needed');
        break;
      
      case 'checkout.session.completed':
        console.log('Processing checkout.session.completed event');
        // ❌ ไม่ต้องทำอะไรกับ checkout.session.completed เพราะใช้ PromptPay
        console.log('Checkout session completed - no action needed for PromptPay');
        break;
      
      case 'checkout.session.expired':
        console.log('Processing checkout.session.expired event');
        // ❌ ไม่ต้องทำอะไรกับ checkout.session.expired เพราะใช้ PromptPay
        console.log('Checkout session expired - no action needed for PromptPay');
        break;
      
      case 'charge.succeeded':
        console.log('Processing charge.succeeded event for PromptPay');
        await handleChargeSucceeded(event.data.object);
        break;
      
      case 'charge.updated':
        console.log('Processing charge.updated event');
        // ❌ ไม่ต้องทำอะไรกับ charge.updated เพราะไม่เกี่ยวข้องกับ PromptPay
        console.log('Charge updated - no action needed for PromptPay');
        break;
      
      // ✅ เพิ่มการจัดการ charge.succeeded สำหรับ PromptPay
      case 'charge.succeeded':
        console.log('Processing charge.succeeded event for PromptPay');
        await handleChargeSucceeded(event.data.object);
        break;
      
      // ✅ เพิ่มการจัดการ charge.failed สำหรับ PromptPay
      case 'charge.failed':
        console.log('Processing charge.failed event for PromptPay');
        await handleChargeFailed(event.data.object);
        break;
      
      // เพิ่ม event types ที่อาจเกิดขึ้นกับ PromptPay
      case 'payment_intent.processing':
        console.log('Processing payment_intent.processing event');
        // PromptPay อาจส่ง event นี้ก่อน succeeded - ไม่ต้องทำอะไร
        console.log('Payment intent processing - no action needed');
        break;
      
      case 'payment_intent.requires_action':
        console.log('Processing payment_intent.requires_action event');
        // PromptPay อาจส่ง event นี้เมื่อต้องการ action - ไม่ต้องทำอะไร
        console.log('Payment intent requires action - no action needed');
        break;
      
      default:
        console.log(`Unhandled event type: ${event.type}`);
        // Log ข้อมูลเพิ่มเติมสำหรับ event ที่ไม่รู้จัก
        console.log('Unknown event data:', {
          eventType: event.type,
          eventId: event.id,
          objectId: event.data?.object?.id,
          objectType: event.data?.object?.object
        });
    }

    // เพิ่ม event.id เข้า Set หลังจากประมวลผลสำเร็จ
    processedEventIds.add(event.id);
    
    res.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
};

// จัดการการชำระเงินสำเร็จ
const handlePaymentSuccess = async (paymentIntent) => {
  try {
    console.log('🎉 Payment succeeded - starting processing:', {
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      timestamp: new Date().toISOString()
    });
    console.log('📋 Payment intent details:', {
      id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      metadata: paymentIntent.metadata,
      payment_method_types: paymentIntent.payment_method_types
    });
    
    // ตรวจสอบว่า payment intent นี้ยังไม่ถูกประมวลผล
    if (paymentIntent.status === 'succeeded') {
      console.log('✅ Processing successful payment for PromptPay...');
      console.log('🔄 Calling PaymentService.handleSuccessfulPayment...');
      
      const result = await PaymentService.handleSuccessfulPayment(paymentIntent);
      
      console.log('✅ Payment success processed successfully for:', {
        paymentIntentId: paymentIntent.id,
        result: result ? 'Order created' : 'No result',
        timestamp: new Date().toISOString()
      });
    } else {
      console.log('❌ Payment intent not succeeded, skipping:', {
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        timestamp: new Date().toISOString()
      });
      // สำหรับ PromptPay อาจต้องรอ event อื่น
      if (paymentIntent.status === 'processing') {
        console.log('⏳ Payment is processing, may need to wait for final status');
      }
    }
  } catch (error) {
    console.error('❌ Handle payment success error:', {
      error: error.message,
      paymentIntentId: paymentIntent.id,
      timestamp: new Date().toISOString()
    });
  }
};

// จัดการการชำระเงินล้มเหลว
const handlePaymentFailure = async (paymentIntent) => {
  try {
    console.log('🔄 Payment failed:', {
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status,
      timestamp: new Date().toISOString()
    });
    
    // ✅ เรียก PaymentService เพื่อจัดการการชำระเงินล้มเหลว
    await PaymentService.handleFailedPayment(paymentIntent);
    
    console.log('✅ Payment failure handled successfully for:', paymentIntent.id);
  } catch (error) {
    console.error('❌ Handle payment failure error:', {
      error: error.message,
      paymentIntentId: paymentIntent.id,
      timestamp: new Date().toISOString()
    });
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

// ✅ เพิ่มการจัดการ charge.failed สำหรับ PromptPay
const handleChargeFailed = async (charge) => {
  try {
    console.log('Charge failed for PromptPay:', charge.id);
    console.log('Charge details:', {
      id: charge.id,
      paymentIntentId: charge.payment_intent,
      status: charge.status,
      amount: charge.amount,
      failureReason: charge.failure_reason || 'Unknown'
    });
    
    // ถ้ามี payment_intent ให้จัดการการชำระเงินล้มเหลว
    if (charge.payment_intent) {
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(charge.payment_intent);
        console.log('Payment intent found for failed charge:', paymentIntent.id);
        
        // เรียก PaymentService เพื่อจัดการการชำระเงินล้มเหลว
        await PaymentService.handleFailedPayment(paymentIntent);
        
      } catch (retrieveError) {
        console.error('Error retrieving payment intent for failed charge:', retrieveError.message);
      }
    } else {
      console.log('Charge has no associated payment intent');
    }
  } catch (error) {
    console.error('Handle charge failed error:', error);
  }
};

// ✅ เพิ่มการจัดการ charge.succeeded สำหรับ PromptPay
const handleChargeSucceeded = async (charge) => {
  try {
    console.log('Charge succeeded for PromptPay:', charge.id);
    console.log('Charge details:', {
      id: charge.id,
      paymentIntentId: charge.payment_intent,
      status: charge.status,
      amount: charge.amount,
      currency: charge.currency
    });

    // ตรวจสอบว่า charge นี้ยังไม่ถูกประมวลผล
    if (charge.status === 'succeeded' && charge.payment_intent) {
      console.log('Processing successful charge for PromptPay...');
      
      try {
        // ดึง Payment Intent จาก charge
        const paymentIntent = await stripe.paymentIntents.retrieve(charge.payment_intent);
        console.log('Payment intent retrieved for charge:', paymentIntent.id);
        
        // ตรวจสอบว่า payment intent นี้ยังไม่ถูกประมวลผล
        if (paymentIntent.metadata && paymentIntent.metadata.processed === 'true') {
          console.log('Payment intent already processed, skipping:', paymentIntent.id);
          return;
        }
        
        // เรียก PaymentService เพื่อสร้าง Order
        await PaymentService.handleSuccessfulPayment(paymentIntent);
        console.log('Charge success processed successfully for:', charge.id);
        
      } catch (retrieveError) {
        console.error('Error retrieving payment intent for charge:', retrieveError.message);
        
        // ถ้าไม่สามารถดึง payment intent ได้ ให้ใช้ charge เป็นตัวแทน
        if (retrieveError.code === 'resource_missing') {
          console.log('Payment intent not found, may have been deleted');
        }
      }
    } else {
      console.log('Charge not succeeded or missing payment_intent, skipping:', charge.status);
    }
  } catch (error) {
    console.error('Handle charge succeeded error:', error);
  }
};

// ❌ ลบฟังก์ชันที่ไม่จำเป็นออกเพราะใช้ PromptPay เท่านั้น
// ไม่ต้องจัดการ checkout session หรือ charge events

module.exports = {
  createPaymentIntent,
  checkPaymentStatus,
  cancelPayment,
  handleWebhook
};
