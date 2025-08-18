# 🚀 การตั้งค่าระบบชำระเงิน Stripe

## 📋 ข้อกำหนดเบื้องต้น

1. **Stripe Account**: ต้องมีบัญชี Stripe (สามารถใช้ test mode ได้)
2. **Node.js**: เวอร์ชัน 14 หรือสูงกว่า
3. **MongoDB**: ฐานข้อมูลที่เชื่อมต่อแล้ว

## 🔑 การตั้งค่า Environment Variables

สร้างไฟล์ `.env` ในโฟลเดอร์ `possibleserver` และเพิ่มการตั้งค่าต่อไปนี้:

```env
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_publishable_key_here

# Frontend URL (for redirects)
FRONTEND_URL=http://localhost:3000
```

## 🛠️ การตั้งค่า Stripe Dashboard

### 1. สร้าง API Keys
1. ไปที่ [Stripe Dashboard](https://dashboard.stripe.com/)
2. ไปที่ **Developers > API keys**
3. คัดลอก **Publishable key** และ **Secret key**
4. ใส่ในไฟล์ `.env`

### 2. ตั้งค่า Webhook
1. ไปที่ **Developers > Webhooks**
2. กด **Add endpoint**
3. ใส่ URL: `https://your-domain.com/api/v1/stripe/webhook`
4. เลือก events:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `payment_intent.canceled`
5. คัดลอก **Signing secret** และใส่ใน `STRIPE_WEBHOOK_SECRET`

### 3. เปิดใช้งาน PromptPay
1. ไปที่ **Settings > Payment methods**
2. เปิดใช้งาน **PromptPay**
3. ตั้งค่า PromptPay settings ตามต้องการ

## 📱 API Endpoints

### 1. สร้างการชำระเงิน
```http
POST /api/v1/stripe/create-payment-intent
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "amount": 1500,
  "currency": "thb",
  "orderId": "order_123",
  "description": "การชำระเงินสินค้า",
  "orderData": {
    "userName": "John Doe",
    "products": [...],
    "subtotal": 1500,
    "total": 1500
  }
}
```

### 2. ตรวจสอบสถานะการชำระเงิน
```http
GET /api/v1/stripe/payment-status/:paymentIntentId
Authorization: Bearer <jwt_token>
```

### 3. ยกเลิกการชำระเงิน
```http
POST /api/v1/stripe/cancel-payment/:paymentIntentId
Authorization: Bearer <jwt_token>
```

### 4. Webhook (ไม่ต้อง auth)
```http
POST /api/v1/stripe/webhook
Content-Type: application/json
Stripe-Signature: <stripe_signature>
```

## 🔄 การทำงานของระบบ

### 1. การสร้างการชำระเงิน
1. User ส่งข้อมูลการชำระเงิน
2. ระบบสร้าง Stripe Payment Intent
3. ระบบสร้าง QR Code สำหรับ PromptPay
4. ระบบสร้าง Order ใหม่ (ถ้ามี orderData)
5. ส่งกลับ QR Code URL และ Payment Intent ID

### 2. การชำระเงินผ่าน PromptPay
1. User สแกน QR Code ด้วยแอปธนาคาร
2. ธนาคารส่งข้อมูลการชำระเงินไปยัง Stripe
3. Stripe อัปเดต Payment Intent status
4. Stripe ส่ง webhook ไปยังระบบ
5. ระบบอัปเดตสถานะ Order และส่งการแจ้งเตือน

### 3. การตรวจสอบสถานะ
1. User สามารถตรวจสอบสถานะการชำระเงินได้
2. ระบบดึงข้อมูลจาก Stripe API
3. ส่งกลับสถานะปัจจุบัน

## 🧪 การทดสอบ

### 1. Test Mode
- ใช้ test API keys
- ใช้ test PromptPay QR codes
- ทดสอบการชำระเงินสำเร็จ/ล้มเหลว

### 2. Test Cards (ถ้าใช้ card payment)
- Success: `4242 4242 4242 4242`
- Failure: `4000 0000 0000 0002`

## 🚨 การแก้ไขปัญหา

### 1. Webhook ไม่ทำงาน
- ตรวจสอบ webhook URL
- ตรวจสอบ webhook secret
- ตรวจสอบ firewall/network settings

### 2. QR Code ไม่แสดง
- ตรวจสอบ Stripe account settings
- ตรวจสอบ PromptPay configuration
- ตรวจสอบ API keys

### 3. การชำระเงินล้มเหลว
- ตรวจสอบ error logs
- ตรวจสอบ Stripe dashboard
- ตรวจสอบ webhook events

## 📚 เอกสารเพิ่มเติม

- [Stripe API Documentation](https://stripe.com/docs/api)
- [Stripe PromptPay Guide](https://stripe.com/docs/payments/promptpay)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
- [Stripe Testing](https://stripe.com/docs/testing)

## 🆘 การติดต่อ

หากมีปัญหาหรือคำถาม สามารถติดต่อได้ที่:
- Email: support@yourcompany.com
- GitHub Issues: [Repository Issues](https://github.com/your-repo/issues)
