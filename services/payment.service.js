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

  // ❌ ลบฟังก์ชัน createOrderWithStripePayment ออก - ไม่ใช้แล้ว
  // ระบบจะสร้าง Order เมื่อชำระเงินสำเร็จเท่านั้น

  // ✅ ฟังก์ชันลบ Order ที่หมดเวลารอชำระเงิน (5 นาที)
  static async cleanupExpiredOrders() {
    try {
      // ✅ ระบบใหม่ไม่สร้าง Order ด้วยสถานะ "รอชำระเงิน" แล้ว
      console.log('No expired orders to clean up - system creates orders only after successful payment');
      return 0;
    } catch (error) {
      console.error('Cleanup expired orders error:', error);
      throw error;
    }
  }

  // ✅ ฟังก์ชันตัดสต็อกสินค้าเมื่อชำระเงินสำเร็จ
  static async processStockReduction(order) {
    try {
      console.log(`Processing stock reduction for order: ${order._id}`);
      
      for (const product of order.products) {
        const productDoc = await ProductModel.findById(product.productId);
        if (!productDoc) {
          console.error(`Product not found: ${product.productId}`);
          continue;
        }

        let requiredQuantity = product.quantity;
        if (product.pack) {
          requiredQuantity *= product.packSize;
        }

        // ตรวจสอบว่าสต็อกยังเพียงพอหรือไม่
        if (productDoc.totalQuantity < requiredQuantity) {
          console.error(`Insufficient stock for ${product.productName}. Available: ${productDoc.totalQuantity}, Required: ${requiredQuantity}`);
          continue;
        }

        // ตัดสต็อกสินค้าแบบ FIFO
        let options = {};
        const nowDate = new Date();
        
        // ตรวจสอบโปรโมชั่นที่ใช้งานได้
        const activePromoForProduct = await PromotionModel.findOne({
          productId: product.productId,
          validityStart: { $lte: nowDate },
          validityEnd: { $gte: nowDate }
        }).lean();

        if (activePromoForProduct && Array.isArray(activePromoForProduct.appliedLots) && activePromoForProduct.appliedLots.length > 0) {
          options.excludeLotNumbers = activePromoForProduct.appliedLots;
        }

        const reductionResult = productDoc.reduceLotQuantity(requiredQuantity, options);
        
        if (!reductionResult.success) {
          console.error(`Failed to reduce stock for ${product.productName}. Shortage: ${reductionResult.remainingShortage}`);
          continue;
        }
        
        // เก็บข้อมูลล็อตที่ใช้ในการขาย
        const lotsUsed = reductionResult.reductions.map(reduction => {
          const lot = productDoc.lots.find(l => l.lotNumber === reduction.lotNumber);
          return {
            lotNumber: reduction.lotNumber,
            quantityTaken: reduction.quantityTaken,
            purchasePrice: lot.purchasePrice,
            expirationDate: lot.expirationDate
          };
        });

        // อัปเดตข้อมูลล็อตใน Order
        await OrderModel.findByIdAndUpdate(order._id, {
          $set: {
            [`products.${order.products.findIndex(p => p.productId.toString() === product.productId)}.lotsUsed`]: lotsUsed
          }
        });

        await productDoc.save();
        console.log(`Stock reduced for ${product.productName}: ${requiredQuantity} units`);
      }
      
      console.log(`Stock reduction completed for order: ${order._id}`);
    } catch (error) {
      console.error('Process stock reduction error:', error);
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
            payment_method_types: paymentIntent.paymentIntent.payment_method_types
          }
        }
      };
    } catch (error) {
      console.error('Verify stripe payment error:', error);
      throw error;
    }
  }

  // ✅ จัดการการชำระเงินสำเร็จ - ปรับปรุงให้สร้าง Order ครั้งเดียว
  static async handleSuccessfulPayment(paymentIntent) {
    try {
      console.log('🎯 Processing successful payment for:', paymentIntent.id);
      console.log('📋 Payment intent metadata:', paymentIntent.metadata);
      
      // ตรวจสอบว่า payment intent นี้ถูกประมวลผลแล้วหรือไม่
      if (paymentIntent.metadata && paymentIntent.metadata.processed === 'true') {
        console.log('⚠️ Payment already processed, skipping:', paymentIntent.id);
        return;
      }
      
      // ✅ สร้าง Order ใหม่เมื่อชำระเงินสำเร็จเท่านั้น
      const cartData = paymentIntent.metadata?.cartData;
      const userName = paymentIntent.metadata?.userName;
      
      console.log('🔍 Extracted metadata:', {
        hasCartData: !!cartData,
        hasUserName: !!userName,
        userName: userName
      });
      
      if (cartData && userName) {
        try {
          console.log('📝 Parsing cart data...');
          const parsedCartData = JSON.parse(cartData);
          console.log('✅ Cart data parsed successfully:', {
            itemCount: parsedCartData.cartItems?.length,
            totalAmount: parsedCartData.totalAmount,
            userName: parsedCartData.userName
          });
          
          console.log('🏗️ Creating order from cart data...');
          const order = await this.createOrderFromCartData(parsedCartData, paymentIntent.id);
          
          if (order) {
            console.log('✅ Order created successfully:', order._id);
            
            // อัปเดต metadata เพื่อป้องกันการประมวลผลซ้ำ
            console.log('🔧 Updating payment intent metadata...');
            await stripe.paymentIntents.update(paymentIntent.id, {
              metadata: { 
                ...paymentIntent.metadata, 
                processed: 'true',
                orderId: order._id.toString()
              }
            });
            
            console.log('✅ Metadata updated successfully');
            console.log(`🎉 Order creation completed: ${order._id} for user: ${userName}`);
            return order;
          } else {
            console.error('❌ Order creation returned null');
          }
        } catch (parseError) {
          console.error('❌ Error parsing cart data:', parseError);
          console.error('❌ Raw cart data:', cartData);
        }
      } else {
        console.error('❌ Missing cart data or userName in payment intent metadata');
        console.error('❌ Metadata breakdown:', {
          cartData: cartData,
          userName: userName,
          fullMetadata: paymentIntent.metadata
        });
      }
    } catch (error) {
      console.error('❌ Handle successful payment error:', error);
      console.error('❌ Error stack:', error.stack);
    }
  }

  // ✅ ฟังก์ชันตัดสต็อกสินค้าสำหรับ Order ที่ชำระเงินสำเร็จ
  static async reduceStockForOrder(order) {
    try {
      console.log('Reducing stock for order:', order._id);
      
      for (const product of order.products) {
        const productToReduce = await ProductModel.findById(product.productId);
        if (!productToReduce) {
          console.error(`Product not found: ${product.productId}`);
          continue;
        }

        let requiredQuantity = product.quantity;
        if (product.pack) {
          requiredQuantity *= product.packSize || 1;
        }

        // ตัดสต็อกแบบ FIFO
        const reductionResult = productToReduce.reduceLotQuantity(requiredQuantity);
        
        if (!reductionResult.success) {
          console.error(`Failed to reduce stock for ${product.productName}. Shortage: ${reductionResult.remainingShortage}`);
          continue;
        }
        
        await productToReduce.save();
        console.log(`Stock reduced for product: ${product.productName}, quantity: ${requiredQuantity}`);
      }
      
      console.log('Stock reduction completed for order:', order._id);
    } catch (error) {
      console.error('Error reducing stock for order:', error);
      throw error;
    }
  }

  // ✅ ฟังก์ชันยกเลิก Order และคืนสต็อก
  static async cancelOrderAndRestoreStock(orderId) {
    try {
      console.log('Canceling order and restoring stock:', orderId);
      
      const order = await OrderModel.findById(orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      // ตรวจสอบว่า Order ยังไม่ถูกตัดสต็อก
      if (order.orderStatus === 'รอชำระเงิน') {
        // อัปเดตสถานะเป็นยกเลิก
        await OrderModel.findByIdAndUpdate(orderId, {
          $set: {
            orderStatus: 'ยกเลิก',
            'stripePayment.paymentStatus': 'canceled',
            canceledAt: new Date()
          }
        });
        
        console.log(`Order ${orderId} canceled successfully`);
        return true;
      } else {
        console.log(`Order ${orderId} cannot be canceled - status: ${order.orderStatus}`);
        return false;
      }
    } catch (error) {
      console.error('Error canceling order:', error);
      throw error;
    }
  }

  // ✅ ฟังก์ชันจัดการ Order ที่หมดเวลา (เรียกจาก Cron Job)
  static async cleanupExpiredOrders() {
    try {
      console.log('Starting cleanup of expired orders...');
      
      // ✅ ระบบใหม่ไม่สร้าง Order ด้วยสถานะ "รอชำระเงิน" แล้ว
      console.log('No expired orders to clean up - system creates orders only after successful payment');
      return 0;
    } catch (error) {
      console.error('Error in cleanup expired orders:', error);
      throw error;
    }
  }

  // ❌ ลบฟังก์ชันที่ซ้ำซ้อนออก - ไม่ใช้แล้ว

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

  // ✅ สร้าง Order จากข้อมูลตะกร้า (ใช้เมื่อชำระเงินสำเร็จเท่านั้น)
  static async createOrderFromCartData(cartData, paymentIntentId) {
    try {
      const { cartItems, userName, totalAmount } = cartData;
      
      // ✅ ตรวจสอบข้อมูลที่จำเป็น
      if (!cartItems || cartItems.length === 0) {
        throw new Error('Cart is empty');
      }
      
      if (!userName || userName === 'Guest') {
        throw new Error('Invalid username');
      }
      
      if (!totalAmount || totalAmount <= 0) {
        throw new Error('Invalid total amount');
      }

      console.log(`Creating order for user: ${userName}, items: ${cartItems.length}, total: ${totalAmount}`);

      // ตรวจสอบว่าสินค้าในสต็อกเพียงพอหรือไม่
      for (const item of cartItems) {
        const product = await ProductModel.findById(item.productId);
        if (!product) {
          throw new Error(`Product ${item.productName || item.name} not found`);
        }

        let requiredQuantity = item.quantity;
        if (item.pack) {
          requiredQuantity *= product.packSize;
        }

        if (product.totalQuantity < requiredQuantity) {
          throw new Error(`Not enough stock for ${item.productName || item.name}. Available: ${product.totalQuantity}, Required: ${requiredQuantity}`);
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
          throw new Error(`Product ${item.productName || item.name} not found`);
        }

        let requiredQuantity = item.quantity;
        if (item.pack) {
          requiredQuantity *= currentProduct.packSize;
        }

        // ใช้ราคาทุนจาก ProductModel
        const purchasePrice = item.pack 
          ? (currentProduct.averagePurchasePrice || 0) * currentProduct.packSize
          : (currentProduct.averagePurchasePrice || 0);

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
          productName: currentProduct.productName,
          quantity: item.quantity,
          purchasePrice: purchasePrice,
          sellingPricePerUnit: finalPrice,
          pack: item.pack,
          originalPrice: item.price,
          discountAmount: itemDiscount,
          packSize: currentProduct.packSize
        });
      }

      const total = subtotal;

      // ✅ สร้าง Order ใหม่ด้วย paymentMethod เป็น "BankTransfer"
      const order = new OrderModel({
        userName: userName,
        products,
        subtotal,
        total,
        promotionId: appliedPromotions,
        paymentMethod: 'BankTransfer',
        cash_received: 0,
        change: 0,
        orderDate: new Date(),
        orderStatus: 'ขายสำเร็จ', // ตั้งสถานะเป็นขายสำเร็จทันที
        stripePayment: {
          paymentIntentId: paymentIntentId,
          paymentStatus: 'succeeded', // ✅ แก้ไขให้ตรงกับ Stripe
          paidAt: new Date()
        }
      });

      // ✅ บันทึก Order ก่อน
      const savedOrder = await order.save();
      console.log(`Order created successfully: ${savedOrder._id}`);

      // ✅ ตัดสต็อกสินค้าหลังจากสร้าง Order สำเร็จ
      try {
        await this.processStockReduction(savedOrder);
        console.log(`Stock reduction completed for order: ${savedOrder._id}`);
      } catch (stockError) {
        console.error(`Stock reduction failed for order: ${savedOrder._id}:`, stockError);
        // ✅ อัปเดตสถานะ Order เป็น error
        await OrderModel.findByIdAndUpdate(savedOrder._id, {
          $set: {
            orderStatus: 'ยกเลิก',
            'stripePayment.paymentStatus': 'failed',
            'stripePayment.failureReason': 'Stock reduction failed: ' + stockError.message
          }
        });
        throw new Error(`Order created but stock reduction failed: ${stockError.message}`);
      }

      // ✅ เคลียร์ตะกร้าหลังจากสร้าง order และตัดสต็อกสำเร็จ
      try {
        await CartModel.deleteMany({ userName: userName });
        console.log(`Cart cleared for user: ${userName}`);
      } catch (cartError) {
        console.error(`Failed to clear cart for user: ${userName}:`, cartError);
        // ไม่ throw error เพราะ Order ถูกสร้างแล้ว
      }

      console.log(`Order creation completed successfully: ${savedOrder._id} for user: ${userName}`);
      return savedOrder;
    } catch (error) {
      console.error('Create order from cart data error:', error);
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
    }
  }
}

module.exports = PaymentService;
