const OrderModel = require('../models/Order');
const CartModel = require('../models/Cart');
const ProductModel = require('../models/Product');
const PromotionModel = require('../models/Promotion');
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

  // สร้าง Order ใหม่พร้อม Stripe Payment - แก้ให้เป็น BankTransfer
  static async createOrderWithStripePayment(orderData, paymentIntentId, qrCodeUrl) {
    try {
      // ดึงสินค้าจากตะกร้าของผู้ใช้
      const cartItems = await CartModel.find({ userName: orderData.userName });
      if (cartItems.length === 0) {
        throw new Error('Cart is empty');
      }

      // ตรวจสอบว่าสินค้าในสต็อกเพียงพอหรือไม่
      for (const item of cartItems) {
        const product = await ProductModel.findById(item.productId);
        if (!product) {
          throw new Error(`Product ${item.productName} not found`);
        }

        let requiredQuantity = item.quantity;
        if (item.pack) {
          requiredQuantity *= product.packSize;
        }

        if (product.totalQuantity < requiredQuantity) {
          throw new Error(`Not enough stock for ${item.productName}. Available: ${product.totalQuantity}, Required: ${requiredQuantity}`);
        }
      }

      // คำนวณราคาทั้งหมดและโปรโมชั่น
      let subtotal = 0;
      let totalDiscount = 0;
      const products = [];
      const appliedPromotions = [];
      
      for (const item of cartItems) {
        const currentProduct = await ProductModel.findById(item.productId);
        if (!currentProduct) {
          throw new Error(`Product ${item.productName} not found`);
        }

        let requiredQuantity = item.quantity;
        if (item.pack) {
          requiredQuantity *= currentProduct.packSize;
        }

        // ใช้ราคาทุนจาก ProductModel
        const purchasePrice = item.pack 
          ? (currentProduct.averagePurchasePrice || 0) * currentProduct.packSize
          : (currentProduct.averagePurchasePrice || 0);

        // ✅ Debug: ตรวจสอบข้อมูลที่ส่งมา
        console.log('Processing cart item:', {
          itemId: item._id,
          itemName: item.name,
          itemProductName: item.productName,
          currentProductName: currentProduct.productName,
          finalName: item.name || item.productName || currentProduct.productName
        });

        // ตีความโปรโมชันจากบรรทัดในตะกร้า
        const nowDate = new Date();
        let finalPrice = item.price;
        let itemDiscount = 0;
        let promoDocForLine = null;
        if (item.promotionId) {
          const promoById = await PromotionModel.findById(item.promotionId);
          if (promoById && promoById.productId?.toString() === item.productId.toString() && new Date(promoById.validityStart) <= nowDate && nowDate <= new Date(promoById.validityEnd)) {
            promoDocForLine = promoById;
            finalPrice = promoById.discountedPrice;
            itemDiscount = (item.price - promoById.discountedPrice) * item.quantity;
            totalDiscount += itemDiscount;
            appliedPromotions.push({
              productId: promoById._id,
              promotionName: promoById.promotionName,
              discountedPrice: promoById.discountedPrice,
              originalPrice: item.price,
              discountAmount: itemDiscount
            });
          }
        }

        subtotal += finalPrice * item.quantity;
        products.push({
          productId: item.productId,
          image: item.image,
          productName: currentProduct.productName, // ใช้ชื่อจาก Product Model เป็นหลัก
          quantity: item.quantity,
          purchasePrice: purchasePrice,
          sellingPricePerUnit: finalPrice,
          pack: item.pack,
          originalPrice: item.price,
          discountAmount: itemDiscount,
          packSize: currentProduct.packSize
        });

        // ✅ ตัดสต็อกสินค้าแบบ FIFO (เหมือน order controller)
        const productToReduce = await ProductModel.findById(item.productId);
        let options = {};
        const activePromoForProduct = await PromotionModel.findOne({
          productId: item.productId,
          validityStart: { $lte: nowDate },
          validityEnd: { $gte: nowDate }
        }).lean();
        if (item.promotionId && promoDocForLine && Array.isArray(promoDocForLine.appliedLots) && promoDocForLine.appliedLots.length > 0) {
          options.includeOnlyLotNumbers = promoDocForLine.appliedLots;
        } else if (activePromoForProduct && Array.isArray(activePromoForProduct.appliedLots) && activePromoForProduct.appliedLots.length > 0) {
          options.excludeLotNumbers = activePromoForProduct.appliedLots;
        }
        const reductionResult = productToReduce.reduceLotQuantity(requiredQuantity, options);
        
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
        const productIndex = products.findIndex(p => p.productId === item.productId);
        if (productIndex !== -1) {
          products[productIndex].lotsUsed = lotsUsed;
        }
      }

      const total = subtotal;

      // ✅ ตรวจสอบข้อมูลก่อนสร้าง Order
      console.log('Order data validation:', {
        userName: orderData.userName,
        productsCount: products.length,
        subtotal,
        total,
        firstProduct: products[0] ? {
          productId: products[0].productId,
          productName: products[0].productName,
          image: products[0].image
        } : null
      });

      // สร้าง Order ใหม่ด้วย paymentMethod เป็น "BankTransfer"
      const order = new OrderModel({
        userName: orderData.userName,
        products,
        subtotal,
        total,
        promotionId: appliedPromotions,
        paymentMethod: 'BankTransfer', // เปลี่ยนจาก 'Stripe' เป็น 'BankTransfer'
        cash_received: 0,
        change: 0,
        orderDate: new Date(),
        stripePayment: {
          paymentIntentId: paymentIntentId,
          paymentStatus: 'pending',
          qrCodeUrl: qrCodeUrl
        }
      });

      const savedOrder = await order.save();

      // ✅ เคลียร์ตะกร้าหลังจากสร้าง order สำเร็จ
      await CartModel.deleteMany({ userName: orderData.userName });

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
      
      const orderId = paymentIntent.metadata?.orderId;
      
      if (orderId && orderId !== 'unknown') {
        // หา Order และอัปเดตสถานะ
        const order = await OrderModel.findById(orderId);
        if (order && order.stripePayment && order.stripePayment.paymentIntentId) {
          await this.updateOrderPaymentStatus(orderId, order.stripePayment.paymentIntentId, 'paid');
          
          // อัปเดต metadata เพื่อป้องกันการประมวลผลซ้ำ
          await stripe.paymentIntents.update(paymentIntent.id, {
            metadata: { ...paymentIntent.metadata, processed: 'true' }
          });
        }
        
        // ✅ เคลียร์ตะกร้าหลังจากชำระเงินสำเร็จ (ถ้ายังไม่ได้เคลียร์)
        if (order && order.userName) {
          try {
            await CartModel.deleteMany({ userName: order.userName });
            console.log(`Cart cleared for user: ${order.userName}`);
          } catch (cartError) {
            console.error('Error clearing cart:', cartError);
          }
        }
        
        console.log(`Payment successful for order: ${orderId}`);
      } else {
        console.log('No valid order ID found in payment intent metadata');
      }
    } catch (error) {
      console.error('Handle successful payment error:', error);
      // ไม่ throw error เพื่อไม่ให้ webhook ล้มเหลว
    }
  }

  // จัดการการชำระเงินล้มเหลว
  static async handleFailedPayment(paymentIntent) {
    try {
      const orderId = paymentIntent.metadata.orderId;
      
      if (orderId && orderId !== 'unknown') {
        // หา Payment Link ID จาก Order
        const order = await OrderModel.findById(orderId);
        if (order && order.stripePayment && order.stripePayment.paymentIntentId) {
          await this.updateOrderPaymentStatus(orderId, order.stripePayment.paymentIntentId, 'unpaid', {
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
        if (order && order.stripePayment && order.stripePayment.paymentIntentId) {
          await this.updateOrderPaymentStatus(orderId, order.stripePayment.paymentIntentId, 'expired');
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
