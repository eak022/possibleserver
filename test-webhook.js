const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();

// ทดสอบการสร้าง webhook signature
async function testWebhookSignature() {
  try {
    console.log('🔍 Testing webhook signature verification...');
    
    // สร้าง test payload
    const testPayload = {
      id: 'evt_test_123',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_test_123',
          status: 'succeeded',
          amount: 1000,
          currency: 'thb'
        }
      }
    };
    
    const payload = JSON.stringify(testPayload);
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    
    console.log('📋 Test payload:', payload);
    console.log('🔑 Webhook secret:', secret ? 'set' : 'not set');
    
    if (!secret) {
      console.error('❌ STRIPE_WEBHOOK_SECRET is not set');
      return;
    }
    
    // สร้าง signature
    const timestamp = Math.floor(Date.now() / 1000);
    const signedPayload = `${timestamp}.${payload}`;
    
    // ใช้ crypto เพื่อสร้าง signature (simulate Stripe)
    const crypto = require('crypto');
    const signature = crypto
      .createHmac('sha256', secret)
      .update(signedPayload, 'utf8')
      .digest('hex');
    
    const stripeSignature = `t=${timestamp},v1=${signature}`;
    
    console.log('✅ Generated signature:', stripeSignature);
    
    // ทดสอบการ verify
    const event = stripe.webhooks.constructEvent(
      Buffer.from(payload, 'utf8'),
      stripeSignature,
      secret
    );
    
    console.log('✅ Signature verification successful!');
    console.log('📋 Verified event:', event);
    
  } catch (error) {
    console.error('❌ Signature verification failed:', error.message);
  }
}

// ทดสอบการเชื่อมต่อ Stripe
async function testStripeConnection() {
  try {
    console.log('🔍 Testing Stripe connection...');
    
    const account = await stripe.accounts.retrieve();
    console.log('✅ Stripe connection successful');
    console.log('📋 Account ID:', account.id);
    
  } catch (error) {
    console.error('❌ Stripe connection failed:', error.message);
  }
}

// ทดสอบการดึง Payment Intent
async function testPaymentIntent() {
  try {
    console.log('🔍 Testing Payment Intent retrieval...');
    
    // ใช้ Payment Intent ID จาก logs ของคุณ
    const paymentIntentId = 'pi_3RxtBEHr9z3aAI1E1tW0nrye';
    
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    console.log('✅ Payment Intent retrieved successfully');
    console.log('📋 Payment Intent:', {
      id: paymentIntent.id,
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      metadata: paymentIntent.metadata
    });
    
  } catch (error) {
    console.error('❌ Payment Intent retrieval failed:', error.message);
  }
}

// รันการทดสอบทั้งหมด
async function runTests() {
  console.log('🚀 Starting webhook tests...\n');
  
  await testStripeConnection();
  console.log('');
  
  await testPaymentIntent();
  console.log('');
  
  await testWebhookSignature();
  console.log('');
  
  console.log('✅ All tests completed!');
}

// รันการทดสอบ
runTests().catch(console.error);
