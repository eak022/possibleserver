const OrderModel = require('../models/Order');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

class PaymentService {
  // อัปเดตสถานะการชำระเงินใน Order
  static async updateOrderPaymentStatus(orderId, paymentLinkId, status, additionalData = {}) {
    try {
      const updateData = {
        'stripePayment.paymentStatus': status,
        'stripePayment.paymentLinkId': paymentLinkId
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
  static async createOrderWithStripePayment(orderData, paymentLinkId, qrCodeUrl) {
    try {
      const order = new OrderModel({
        ...orderData,
        paymentMethod: 'Stripe',
        stripePayment: {
          paymentLinkId: paymentLinkId,
          paymentStatus: 'pending',
          qrCodeUrl: qrCodeUrl
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

  // ตรวจสอบสถานะการชำระเงินจาก Stripe Payment Link
  static async verifyStripePayment(paymentLinkId) {
    try {
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

      return {
        id: paymentLink.id,
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
      };
    } catch (error) {
      console.error('Verify stripe payment error:', error);
      throw error;
    }
  }

  // จัดการการชำระเงินสำเร็จ
  static async handleSuccessfulPayment(paymentIntent) {
    try {
      const orderId = paymentIntent.metadata.orderId;
      
      if (orderId && orderId !== 'unknown') {
        // หา Payment Link ID จาก Order
        const order = await OrderModel.findById(orderId);
        if (order && order.stripePayment && order.stripePayment.paymentLinkId) {
          await this.updateOrderPaymentStatus(orderId, order.stripePayment.paymentLinkId, 'paid');
        }
        
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
  static async handleFailedPayment(paymentIntent) {
    try {
      const orderId = paymentIntent.metadata.orderId;
      
      if (orderId && orderId !== 'unknown') {
        // หา Payment Link ID จาก Order
        const order = await OrderModel.findById(orderId);
        if (order && order.stripePayment && order.stripePayment.paymentLinkId) {
          await this.updateOrderPaymentStatus(orderId, order.stripePayment.paymentLinkId, 'unpaid', {
            failureReason: 'การชำระเงินล้มเหลว'
          });
        }
        
        console.log(`Payment failed for order: ${orderId}`);
      }
    } catch (error) {
      console.error('Handle failed payment error:', error);
      throw error;
    }
  }

  // จัดการการยกเลิกการชำระเงิน
  static async handleCanceledPayment(paymentIntent) {
    try {
      const orderId = paymentIntent.metadata.orderId;
      
      if (orderId && orderId !== 'unknown') {
        // หา Payment Link ID จาก Order
        const order = await OrderModel.findById(orderId);
        if (order && order.stripePayment && order.stripePayment.paymentLinkId) {
          await this.updateOrderPaymentStatus(orderId, order.stripePayment.paymentLinkId, 'expired');
        }
        
        console.log(`Payment canceled for order: ${orderId}`);
      }
    } catch (error) {
      console.error('Handle canceled payment error:', error);
      throw error;
    }
  }
}

module.exports = PaymentService;
