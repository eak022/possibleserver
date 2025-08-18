const OrderModel = require('../models/Order');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

class PaymentService {
  // อัปเดตสถานะการชำระเงินใน Order
  static async updateOrderPaymentStatus(orderId, sessionId, status, additionalData = {}) {
    try {
      const updateData = {
        'stripePayment.paymentStatus': status,
        'stripePayment.sessionId': sessionId
      };

      // เพิ่มข้อมูลเพิ่มเติมตามสถานะ
      switch (status) {
        case 'paid':
          updateData['stripePayment.paidAt'] = new Date();
          updateData['orderStatus'] = 'ขายสำเร็จ';
          break;
        
        case 'unpaid':
          updateData['stripePayment.failureReason'] = additionalData.failureReason || 'การชำระเงินล้มเหลว';
          break;
        
        case 'expired':
          updateData['orderStatus'] = 'ยกเลิก';
          break;
      }

      const updatedOrder = await OrderModel.findByIdAndUpdate(
        orderId,
        { $set: updateData },
        { new: true }
      );

      return updatedOrder;
    } catch (error) {
      console.error('Update order payment status error:', error);
      throw error;
    }
  }

  // สร้าง Order ใหม่พร้อม Stripe Payment
  static async createOrderWithStripePayment(orderData, sessionId, checkoutUrl) {
    try {
      const order = new OrderModel({
        ...orderData,
        paymentMethod: 'Stripe',
        stripePayment: {
          sessionId: sessionId,
          paymentStatus: 'pending',
          checkoutUrl: checkoutUrl
        }
      });

      const savedOrder = await order.save();
      return savedOrder;
    } catch (error) {
      console.error('Create order with stripe payment error:', error);
      throw error;
    }
  }

  // ตรวจสอบ Order ที่มีการชำระเงินด้วย Stripe
  static async getStripeOrders(userId = null) {
    try {
      const query = { paymentMethod: 'Stripe' };
      if (userId) {
        query.userId = userId;
      }

      const orders = await OrderModel.find(query)
        .populate('products.productId')
        .sort({ createdAt: -1 });

      return orders;
    } catch (error) {
      console.error('Get stripe orders error:', error);
      throw error;
    }
  }

  // ตรวจสอบสถานะการชำระเงินจาก Stripe Checkout Session
  static async verifyStripePayment(sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      return {
        id: session.id,
        status: session.payment_status,
        amount: session.amount_total / 100,
        currency: session.currency,
        created: session.created,
        metadata: session.metadata
      };
    } catch (error) {
      console.error('Verify stripe payment error:', error);
      throw error;
    }
  }

  // จัดการการชำระเงินสำเร็จ
  static async handleSuccessfulPayment(session) {
    try {
      const orderId = session.metadata.orderId;
      
      if (orderId && orderId !== 'unknown') {
        await this.updateOrderPaymentStatus(orderId, session.id, 'paid');
        
        // TODO: เพิ่มการส่งการแจ้งเตือน
        // TODO: เพิ่มการอัปเดตสต็อก
        
        console.log(`Payment successful for order: ${orderId}`);
      }
    } catch (error) {
      console.error('Handle successful payment error:', error);
      throw error;
    }
  }

  // จัดการการชำระเงินล้มเหลว
  static async handleFailedPayment(session) {
    try {
      const orderId = session.metadata.orderId;
      
      if (orderId && orderId !== 'unknown') {
        await this.updateOrderPaymentStatus(orderId, session.id, 'unpaid', {
          failureReason: 'การชำระเงินล้มเหลว'
        });
        
        console.log(`Payment failed for order: ${orderId}`);
      }
    } catch (error) {
      console.error('Handle failed payment error:', error);
      throw error;
    }
  }

  // จัดการการยกเลิกการชำระเงิน
  static async handleCanceledPayment(session) {
    try {
      const orderId = session.metadata.orderId;
      
      if (orderId && orderId !== 'unknown') {
        await this.updateOrderPaymentStatus(orderId, session.id, 'expired');
        
        console.log(`Payment canceled for order: ${orderId}`);
      }
    } catch (error) {
      console.error('Handle canceled payment error:', error);
      throw error;
    }
  }
}

module.exports = PaymentService;
