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
          // ✅ ส่งเฉพาะข้อมูลที่จำเป็นและกระชับ เพื่อไม่ให้เกิน 500 ตัวอักษร
          description: description || 'การชำระเงิน',
          amount: amount.toString(),
          currency: currency,
          userName: orderData?.userName || 'Guest',
          // ✅ ส่งข้อมูลตะกร้าแบบกระชับ
          cartItems: orderData?.cartItems?.length || 0,
          totalAmount: orderData?.total || amount
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

    // ✅ ไม่สร้าง order ตอนนี้ - รอให้ชำระเงินสำเร็จก่อน
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
    
    console.log('Payment Intent retrieved:', {
      id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      metadata: paymentIntent.metadata
    });
    
    // ดึงข้อมูลการชำระเงินจาก Payment Intent
    let paymentStatus = 'pending';
    
    if (paymentIntent.status === 'succeeded') {
      paymentStatus = 'succeeded'; // ✅ ใช้ 'succeeded' แทน 'paid'
    } else if (paymentIntent.status === 'processing') {
      paymentStatus = 'processing';
    } else if (paymentIntent.status === 'requires_payment_method') {
      paymentStatus = 'unpaid';
    } else if (paymentIntent.status === 'canceled') {
      paymentStatus = 'canceled';
    } else if (paymentIntent.status === 'requires_action') {
      paymentStatus = 'pending';
    }

    console.log('Payment status mapped:', {
      stripeStatus: paymentIntent.status,
      mappedStatus: paymentStatus
    });

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
  console.log('🚀 Webhook handler called!');
  console.log('📝 Request method:', req.method);
  console.log('📝 Request URL:', req.url);
  console.log('📝 Request headers:', req.headers);
  
  const sig = req.headers['stripe-signature'];
  let event;

  // Debug logging ที่ละเอียดขึ้น
  console.log('🔍 Webhook handler called with:', {
    hasSignature: !!sig,
    signatureLength: sig ? sig.length : 0,
    signaturePreview: sig ? sig.substring(0, 20) + '...' : 'none',
    hasBody: !!req.body,
    bodyType: typeof req.body,
    bodyLength: req.body ? req.body.length : 0,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ? 'set' : 'not set',
    webhookSecretPreview: process.env.STRIPE_WEBHOOK_SECRET ? 
      process.env.STRIPE_WEBHOOK_SECRET.substring(0, 20) + '...' : 'none',
    headers: {
      'stripe-signature': req.headers['stripe-signature'] ? 'present' : 'missing',
      'content-type': req.headers['content-type'],
      'content-length': req.headers['content-length']
    }
  });

  // Validate webhook secret
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('❌ STRIPE_WEBHOOK_SECRET is not set');
    return res.status(500).send('Webhook secret not configured');
  }

  // Validate signature header
  if (!sig) {
    console.error('❌ No Stripe signature found in headers');
    return res.status(400).send('No signature found');
  }

  try {
    console.log('🔐 Attempting to verify webhook signature...');
    console.log('📝 Using webhook secret:', process.env.STRIPE_WEBHOOK_SECRET.substring(0, 20) + '...');
    console.log('📝 Signature header:', sig.substring(0, 20) + '...');
    console.log('📝 Body type:', typeof req.body);
    console.log('📝 Body length:', req.body ? req.body.length : 0);
    
    event = stripe.webhooks.constructEvent(
      req.body, // raw Buffer จาก express.raw()
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    
    console.log('✅ Webhook signature verified successfully for event:', event.type);
    console.log('📊 Event data:', {
      id: event.id,
      type: event.type,
      object: event.data?.object?.id,
      status: event.data?.object?.status
    });
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    console.error('🔍 Error details:', {
      errorType: err.type,
      errorCode: err.code,
      errorMessage: err.message,
      stack: err.stack
    });
    
    // เพิ่มข้อมูลเพิ่มเติมสำหรับ debug
    console.error('🔍 Debug info:', {
      webhookSecretLength: process.env.STRIPE_WEBHOOK_SECRET?.length,
      signatureLength: sig?.length,
      bodyLength: req.body?.length,
      bodyType: typeof req.body,
      bodyIsBuffer: Buffer.isBuffer(req.body)
    });
    
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // กันซ้ำด้วย event.id
  if (processedEventIds.has(event.id)) {
    console.log('⚠️ Event already processed, skipping:', event.id);
    return res.json({ received: true });
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        console.log('🟢 Processing payment_intent.succeeded event');
        console.log('📋 Event details:', {
          eventId: event.id,
          paymentIntentId: event.data.object.id,
          status: event.data.object.status,
          metadata: event.data.object.metadata
        });
        console.log('🔍 Starting handlePaymentSuccess...');
        await handlePaymentSuccess(event.data.object);
        console.log('✅ handlePaymentSuccess completed');
        break;
      
      case 'payment_intent.payment_failed':
        console.log('🔴 Processing payment_intent.payment_failed event');
        await handlePaymentFailure(event.data.object);
        break;
      
      case 'payment_intent.canceled':
        console.log('🟡 Processing payment_intent.canceled event');
        await handlePaymentCancel(event.data.object);
        break;
      
      case 'payment_intent.created':
        console.log('🔵 Processing payment_intent.created event');
        await handlePaymentIntentCreated(event.data.object);
        break;
      
      case 'checkout.session.completed':
        console.log('🟢 Processing checkout.session.completed event');
        await handleCheckoutSessionCompleted(event.data.object);
        break;
      
      case 'checkout.session.expired':
        console.log('🟡 Processing checkout.session.expired event');
        await handleCheckoutSessionExpired(event.data.object);
        break;
      
      case 'charge.succeeded':
        console.log('🟢 Processing charge.succeeded event');
        await handleChargeSucceeded(event.data.object);
        break;
      
      case 'charge.updated':
        console.log('🟡 Processing charge.updated event');
        await handleChargeUpdated(event.data.object);
        break;
      
      // เพิ่ม event types ที่อาจเกิดขึ้นกับ PromptPay
      case 'payment_intent.processing':
        console.log('🟡 Processing payment_intent.processing event');
        // PromptPay อาจส่ง event นี้ก่อน succeeded
        break;
      
      case 'payment_intent.requires_action':
        console.log('🟡 Processing payment_intent.requires_action event');
        // PromptPay อาจส่ง event นี้เมื่อต้องการ action
        break;
      
      default:
        console.log(`❓ Unhandled event type: ${event.type}`);
        // Log ข้อมูลเพิ่มเติมสำหรับ event ที่ไม่รู้จัก
        console.log('📝 Unknown event data:', {
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
    console.error('❌ Webhook handler error:', error);
    console.error('🔍 Error stack:', error.stack);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
};

// ✅ จัดการการชำระเงินสำเร็จ - ปรับปรุงให้สร้าง Order ครั้งเดียว
const handlePaymentSuccess = async (paymentIntent) => {
  try {
    console.log('🎯 Payment succeeded:', paymentIntent.id);
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
      
      // ✅ ตรวจสอบว่า Order ถูกสร้างแล้วหรือไม่
      if (paymentIntent.metadata && paymentIntent.metadata.orderId && paymentIntent.metadata.orderId !== 'unknown') {
        console.log('⚠️ Order already exists:', paymentIntent.metadata.orderId);
        return;
      }
      
      // ✅ ตรวจสอบข้อมูลที่จำเป็นใน metadata
      if (!paymentIntent.metadata?.cartData || !paymentIntent.metadata?.userName) {
        console.error('❌ Missing required metadata for order creation:', {
          cartData: !!paymentIntent.metadata?.cartData,
          userName: !!paymentIntent.metadata?.userName,
          fullMetadata: paymentIntent.metadata
        });
        return;
      }
      
      console.log('🔍 Metadata validation passed, creating order...');
      console.log('📝 Cart data preview:', paymentIntent.metadata.cartData.substring(0, 100) + '...');
      console.log('👤 User name:', paymentIntent.metadata.userName);
      
      const order = await PaymentService.handleSuccessfulPayment(paymentIntent);
      
      if (order) {
        console.log('✅ Order created successfully:', order._id);
        console.log('📊 Order details:', {
          orderId: order._id,
          userName: order.userName,
          totalAmount: order.total,
          orderStatus: order.orderStatus,
          paymentStatus: order.stripePayment?.paymentStatus
        });
      } else {
        console.error('❌ Failed to create order for payment intent:', paymentIntent.id);
        console.error('❌ Payment intent metadata:', paymentIntent.metadata);
      }
      console.log('✅ Payment success processed successfully for:', paymentIntent.id);
    } else {
      console.log('⚠️ Payment intent not succeeded, skipping:', paymentIntent.status);
      // สำหรับ PromptPay อาจต้องรอ event อื่น
      if (paymentIntent.status === 'processing') {
        console.log('⏳ Payment is processing, may need to wait for final status');
      }
    }
  } catch (error) {
    console.error('❌ Handle payment success error:', error);
    console.error('🔍 Error stack:', error.stack);
    console.error('📝 Payment intent that caused error:', {
      id: paymentIntent.id,
      status: paymentIntent.status,
      metadata: paymentIntent.metadata
    });
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

// ✅ จัดการ checkout session completed - ปรับปรุงให้สร้าง Order ครั้งเดียว
const handleCheckoutSessionCompleted = async (session) => {
  try {
    console.log('Checkout session completed:', session.id);
    if (session.payment_intent) {
      const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
      
      // ✅ ตรวจสอบว่า Order ถูกสร้างแล้วหรือไม่
      if (paymentIntent.metadata && paymentIntent.metadata.orderId && paymentIntent.metadata.orderId !== 'unknown') {
        console.log('Order already exists from checkout session:', paymentIntent.metadata.orderId);
        return;
      }
      
      // ✅ ตรวจสอบข้อมูลที่จำเป็นใน metadata
      if (!paymentIntent.metadata?.cartData || !paymentIntent.metadata?.userName) {
        console.error('Missing required metadata for order creation from checkout session:', {
          cartData: !!paymentIntent.metadata?.cartData,
          userName: !!paymentIntent.metadata?.userName
        });
        return;
      }
      
      const order = await PaymentService.handleSuccessfulPayment(paymentIntent);
      if (order) {
        console.log('Order created successfully from checkout session:', order._id);
      } else {
        console.error('Failed to create order from checkout session:', session.id);
      }
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

// ✅ จัดการ charge succeeded - ปรับปรุงให้สร้าง Order ครั้งเดียว
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
          // ✅ ตรวจสอบว่า Order ถูกสร้างแล้วหรือไม่
          if (paymentIntent.metadata && paymentIntent.metadata.orderId && paymentIntent.metadata.orderId !== 'unknown') {
            console.log('Order already exists from charge:', paymentIntent.metadata.orderId);
            return;
          }
          
          // ✅ ตรวจสอบข้อมูลที่จำเป็นใน metadata
          if (!paymentIntent.metadata?.cartData || !paymentIntent.metadata?.userName) {
            console.error('Missing required metadata for order creation from charge:', {
              cartData: !!paymentIntent.metadata?.cartData,
              userName: !!paymentIntent.metadata?.userName
            });
            return;
          }
          
          const order = await PaymentService.handleSuccessfulPayment(paymentIntent);
          if (order) {
            console.log('Order created successfully from charge:', order._id);
          } else {
            console.error('Failed to create order from charge:', charge.id);
          }
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
