const OrderModel = require('../models/Order');
const CartModel = require('../models/Cart');
const ProductModel = require('../models/Product');
const PromotionModel = require('../models/Promotion');
const { checkAndAddStock } = require('../controllers/purchaseOrder.controller');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

class PaymentService {
  // อัปเดตสถานะการชำระเงินใน Order
  static async updateOrderPaymentStatus(orderId, paymentIntentId, status, additionalData = {}) {
    try {
      const updateData = {
        'stripePayment.paymentStatus': status,
        'stripePayment.paymentIntentId': paymentIntentId
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
  static async createOrderWithStripePayment(orderData, paymentIntentId, qrCodeUrl) {
    try {
      // ✅ ตรวจสอบว่าสินค้าในสต็อกเพียงพอหรือไม่
      for (const item of orderData.products) {
        const product = await ProductModel.findById(item.productId);
        if (!product) {
          throw new Error(`Product ${item.productName} not found`);
        }

        let requiredQuantity = item.quantity;
        // ถ้า pack เป็น true คูณจำนวนด้วย packSize ก่อน
        if (item.pack && product.packSize) {
          requiredQuantity *= product.packSize;
        }

        // ตรวจสอบจำนวนสินค้าคงเหลือในสต็อกจาก totalQuantity (รวมทุกล็อต)
        if (product.totalQuantity < requiredQuantity) {
          throw new Error(`Not enough stock for ${item.productName}. Available: ${product.totalQuantity}, Required: ${requiredQuantity}`);
        }
      }

      // ✅ ตัดสต็อกสินค้าทั้งหมดก่อนสร้างออร์เดอร์
      const products = [];
      for (const item of orderData.products) {
        const product = await ProductModel.findById(item.productId);
        let requiredQuantity = item.quantity;
        
        // ถ้า pack เป็น true คูณจำนวนด้วย packSize ก่อน
        if (item.pack && product.packSize) {
          requiredQuantity *= product.packSize;
        }

        // ✅ ตัดสต็อกสินค้าแบบ FIFO (First In, First Out)
        const productToReduce = await ProductModel.findById(item.productId);
        const reductionResult = productToReduce.reduceLotQuantity(requiredQuantity);
        
        if (!reductionResult.success) {
          throw new Error(`Failed to reduce stock for ${item.productName}. Shortage: ${reductionResult.remainingShortage}`);
        }
        
        await productToReduce.save();

        // ✅ เก็บข้อมูลล็อตที่ใช้ในการขาย
        const lotsUsed = reductionResult.reductions.map(reduction => {
          const lot = productToReduce.lots.find(l => l.lotNumber === reduction.lotNumber);
          return {
            lotNumber: reduction.lotNumber,
            quantityTaken: reduction.quantityTaken,
            purchasePrice: lot.purchasePrice,
            expirationDate: lot.expirationDate
          };
        });

        // อัปเดตข้อมูลสินค้าใน products array
        products.push({
          ...item,
          lotsUsed: lotsUsed
        });

        // ตรวจสอบและเติมสต็อกอัตโนมัติหลังจากตัดสต็อก
        await checkAndAddStock(item.productId);
      }

      // ✅ สร้างออร์เดอร์พร้อมข้อมูลล็อตที่ใช้
      const order = new OrderModel({
        ...orderData,
        products: products, // ใช้ products ที่มี lotsUsed แล้ว
        paymentMethod: 'Stripe',
        stripePayment: {
          paymentIntentId: paymentIntentId,
          paymentStatus: 'pending',
          qrCodeUrl: qrCodeUrl
        }
      });

      const savedOrder = await order.save();

      // ✅ ล้างตะกร้าหลังจากสร้างออร์เดอร์สำเร็จ
      if (orderData.userName) {
        await CartModel.deleteMany({ userName: orderData.userName });
      }

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

  // ตรวจสอบสถานะการชำระเงินจาก Stripe Payment Intent
  static async verifyStripePayment(paymentIntentId) {
    try {
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

      return {
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
        }
      };
    } catch (error) {
      console.error('Verify stripe payment error:', error);
      throw error;
    }
  }

  // จัดการการชำระเงินสำเร็จ
  static async handleSuccessfulPayment(paymentIntent) {
    try {
      console.log('Processing successful payment for:', paymentIntent.id);
      
      // ตรวจสอบว่า payment intent นี้ถูกประมวลผลแล้วหรือไม่
      if (paymentIntent.metadata && paymentIntent.metadata.processed === 'true') {
        console.log('Payment already processed, skipping:', paymentIntent.id);
        return;
      }
      
      // ✅ หาออร์เดอร์ที่เกี่ยวข้องกับ payment intent นี้
      const order = await OrderModel.findOne({
        'stripePayment.paymentIntentId': paymentIntent.id
      });
      
      if (order) {
        // ✅ อัปเดตสถานะการชำระเงินเป็น 'paid'
        await this.updateOrderPaymentStatus(order._id, paymentIntent.id, 'paid');
        
        // ✅ อัปเดตสถานะออร์เดอร์เป็น 'ขายสำเร็จ'
        await OrderModel.findByIdAndUpdate(order._id, {
          orderStatus: 'ขายสำเร็จ'
        });
        
        console.log(`Payment successful for order: ${order._id}`);
      } else {
        console.log('No order found for payment intent:', paymentIntent.id);
      }
      
      // อัปเดต metadata เพื่อป้องกันการประมวลผลซ้ำ
      await stripe.paymentIntents.update(paymentIntent.id, {
        metadata: { ...paymentIntent.metadata, processed: 'true' }
      });
      
    } catch (error) {
      console.error('Handle successful payment error:', error);
      // ไม่ throw error เพื่อไม่ให้ webhook ล้มเหลว
    }
  }

  // จัดการการชำระเงินล้มเหลว
  static async handleFailedPayment(paymentIntent) {
    try {
      console.log('Processing failed payment for:', paymentIntent.id);
      
      // ✅ หาออร์เดอร์ที่เกี่ยวข้องกับ payment intent นี้
      const order = await OrderModel.findOne({
        'stripePayment.paymentIntentId': paymentIntent.id
      });
      
      if (order) {
        // ✅ อัปเดตสถานะการชำระเงินเป็น 'unpaid'
        await this.updateOrderPaymentStatus(order._id, paymentIntent.id, 'unpaid', {
          failureReason: 'การชำระเงินล้มเหลว'
        });
        
        // ✅ อัปเดตสถานะออร์เดอร์เป็น 'ยกเลิก'
        await OrderModel.findByIdAndUpdate(order._id, {
          orderStatus: 'ยกเลิก'
        });
        
        // ✅ คืนสต็อกสินค้าตามล็อตที่ใช้
        for (const item of order.products) {
          if (item.lotsUsed && item.lotsUsed.length > 0) {
            // คืนสต็อกตามล็อตที่ใช้ในการขาย
            for (const lotUsed of item.lotsUsed) {
              const product = await ProductModel.findById(item.productId);
              if (product) {
                const lot = product.lots.find(l => l.lotNumber === lotUsed.lotNumber);
                if (lot) {
                  lot.quantity += lotUsed.quantityTaken;
                  if (lot.status === 'depleted' && lot.quantity > 0) {
                    lot.status = 'active';
                  }
                  await product.save();
                }
              }
            }
          }
        }
        
        console.log(`Payment failed for order: ${order._id}, stock restored`);
      }
      
    } catch (error) {
      console.error('Handle failed payment error:', error);
      // ไม่ throw error เพื่อไม่ให้ webhook ล้มเหลว
    }
  }

  // จัดการการชำระเงินที่ถูกยกเลิก
  static async handleCanceledPayment(paymentIntent) {
    try {
      console.log('Processing canceled payment for:', paymentIntent.id);
      
      // ✅ หาออร์เดอร์ที่เกี่ยวข้องกับ payment intent นี้
      const order = await OrderModel.findOne({
        'stripePayment.paymentIntentId': paymentIntent.id
      });
      
      if (order) {
        // ✅ อัปเดตสถานะการชำระเงินเป็น 'expired'
        await this.updateOrderPaymentStatus(order._id, paymentIntent.id, 'expired', {
          failureReason: 'การชำระเงินถูกยกเลิก'
        });
        
        // ✅ อัปเดตสถานะออร์เดอร์เป็น 'ยกเลิก'
        await OrderModel.findByIdAndUpdate(order._id, {
          orderStatus: 'ยกเลิก'
        });
        
        // ✅ คืนสต็อกสินค้าตามล็อตที่ใช้
        for (const item of order.products) {
          if (item.lotsUsed && item.lotsUsed.length > 0) {
            // คืนสต็อกตามล็อตที่ใช้ในการขาย
            for (const lotUsed of item.lotsUsed) {
              const product = await ProductModel.findById(item.productId);
              if (product) {
                const lot = product.lots.find(l => l.lotNumber === lotUsed.lotNumber);
                if (lot) {
                  lot.quantity += lotUsed.quantityTaken;
                  if (lot.status === 'depleted' && lot.quantity > 0) {
                    lot.status = 'active';
                  }
                  await product.save();
                }
              }
            }
          }
        }
        
        console.log(`Payment canceled for order: ${order._id}, stock restored`);
      }
      
    } catch (error) {
      console.error('Handle canceled payment error:', error);
      // ไม่ throw error เพื่อไม่ให้ webhook ล้มเหลว
    }
  }
}

module.exports = PaymentService;
