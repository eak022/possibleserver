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

      // ✅ ตรวจสอบว่าสินค้าในสต็อกเพียงพอหรือไม่ (แต่ยังไม่ตัด)
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

        // ❌ ไม่ตัดสต็อกสินค้าตอนนี้ - รอการชำระเงินสำเร็จ
        // ❌ ไม่เก็บข้อมูลล็อตตอนนี้ - จะเก็บเมื่อชำระเงินสำเร็จ
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
        orderStatus: 'รอชำระเงิน', // ตั้งสถานะเป็น "รอชำระเงิน"
        stripePayment: {
          paymentIntentId: paymentIntentId,
          paymentStatus: 'pending',
          qrCodeUrl: qrCodeUrl
        }
      });

      const savedOrder = await order.save();

      // ❌ ไม่เคลียร์ตะกร้าตอนนี้ - รอการชำระเงินสำเร็จ
      console.log(`Order created successfully: ${savedOrder._id} for user: ${orderData.userName} (pending payment)`);

      return savedOrder;
    } catch (error) {
      console.error('Create order with stripe payment error:', error);
      throw error;
    }
  }

  // ✅ ฟังก์ชันลบ Order ที่หมดเวลารอชำระเงิน (5 นาที)
  static async cleanupExpiredOrders() {
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      // หา Order ที่มีสถานะ "รอชำระเงิน" และสร้างมาเกิน 5 นาที
      const expiredOrders = await OrderModel.find({
        orderStatus: 'รอชำระเงิน',
        'stripePayment.paymentStatus': 'pending',
        createdAt: { $lt: fiveMinutesAgo }
      });
      
      if (expiredOrders.length > 0) {
        console.log(`Found ${expiredOrders.length} expired orders, cleaning up...`);
        
        for (const order of expiredOrders) {
          try {
            // ❌ ไม่ต้องคืนสต็อกเพราะยังไม่ได้ตัดตอนสร้าง Order
            // ❌ ไม่ต้องเคลียร์ตะกร้าเพราะยังไม่ได้เคลียร์ตอนสร้าง Order
            
            // ลบ Order
            await OrderModel.findByIdAndDelete(order._id);
            console.log(`Deleted expired order: ${order._id}`);
            
          } catch (error) {
            console.error(`Error cleaning up expired order ${order._id}:`, error);
          }
        }
        
        console.log(`Cleanup completed. Deleted ${expiredOrders.length} expired orders.`);
      }
      
      return expiredOrders.length;
    } catch (error) {
      console.error('Cleanup expired orders error:', error);
      throw error;
    }
  }

  // ✅ ฟังก์ชันตั้งเวลาลบ Order อัตโนมัติ
  static scheduleOrderCleanup() {
    // ตั้งเวลาลบ Order ทุก 1 นาที
    setInterval(async () => {
      try {
        await this.cleanupExpiredOrders();
      } catch (error) {
        console.error('Scheduled cleanup error:', error);
      }
    }, 60 * 1000); // 1 นาที
    
    console.log('Order cleanup scheduler started - checking every 1 minute');
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
      console.log('🔄 Processing successful payment for:', {
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        timestamp: new Date().toISOString()
      });
      console.log('📋 Payment intent metadata:', paymentIntent.metadata);
      
      // ตรวจสอบว่า payment intent นี้ถูกประมวลผลแล้วหรือไม่
      if (paymentIntent.metadata && paymentIntent.metadata.processed === 'true') {
        console.log('🚫 Payment already processed, skipping:', paymentIntent.id);
        return;
      }
      
      // ❌ ไม่ต้องหาอะไรเพราะไม่มีการสร้าง Order ตอนสร้าง QR Code แล้ว
      // ระบบจะสร้าง Order จาก cartData เมื่อชำระเงินสำเร็จเท่านั้น
      console.log('🔄 Creating new order from cart data...');
      const cartData = paymentIntent.metadata?.cartData;
      const userName = paymentIntent.metadata?.userName;
      
      console.log('📋 Cart data extracted:', {
        hasCartData: !!cartData,
        hasUserName: !!userName,
        cartDataLength: cartData ? cartData.length : 0,
        userName: userName
      });
      
      if (cartData && userName) {
        try {
          const parsedCartData = JSON.parse(cartData);
          console.log('✅ Cart data parsed successfully:', {
            cartItemsCount: parsedCartData.cartItems?.length || 0,
            totalAmount: parsedCartData.totalAmount,
            userName: parsedCartData.userName
          });
          
          const order = await this.createOrderFromCartData(parsedCartData, paymentIntent.id);
          
          if (order) {
            console.log('✅ Order created successfully:', {
              orderId: order._id,
              userName: order.userName,
              total: order.total,
              timestamp: new Date().toISOString()
            });
            
            // อัปเดต metadata เพื่อป้องกันการประมวลผลซ้ำ
            await stripe.paymentIntents.update(paymentIntent.id, {
              metadata: { 
                ...paymentIntent.metadata, 
                processed: 'true',
                orderId: order._id.toString()
              }
            });
            
            console.log('✅ Payment intent metadata updated:', {
              paymentIntentId: paymentIntent.id,
              processed: true,
              orderId: order._id.toString()
            });
            
            return order;
          }
        } catch (parseError) {
          console.error('❌ Error parsing cart data:', {
            error: parseError.message,
            cartData: cartData,
            timestamp: new Date().toISOString()
          });
          throw parseError;
        }
      } else {
        console.error('❌ Missing cart data or userName in payment intent metadata:', {
          hasCartData: !!cartData,
          hasUserName: !!userName,
          metadata: paymentIntent.metadata,
          timestamp: new Date().toISOString()
        });
        throw new Error('Missing cart data or userName');
      }
    } catch (error) {
      console.error('❌ Handle successful payment error:', {
        error: error.message,
        paymentIntentId: paymentIntent.id,
        timestamp: new Date().toISOString()
      });
      throw error;
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
      
      // หา Order ที่หมดเวลา (สร้างเกิน 5 นาที และยังไม่ชำระเงิน)
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      const expiredOrders = await OrderModel.find({
        orderStatus: 'รอชำระเงิน',
        paymentMethod: 'BankTransfer',
        createdAt: { $lt: fiveMinutesAgo }
      });

      console.log(`Found ${expiredOrders.length} expired orders`);

      for (const order of expiredOrders) {
        try {
          // ยกเลิก Order
          await this.cancelOrderAndRestoreStock(order._id);
          
          // ลบข้อมูลการชำระเงินจาก localStorage (ถ้ามี)
          if (order.stripePayment?.paymentIntentId) {
            console.log(`Order ${order._id} expired and canceled`);
          }
        } catch (error) {
          console.error(`Error canceling expired order ${order._id}:`, error);
        }
      }

      console.log('Expired orders cleanup completed');
      return expiredOrders.length;
    } catch (error) {
      console.error('Error in cleanup expired orders:', error);
      throw error;
    }
  }

  // ✅ ฟังก์ชันลบ Order ที่หมดเวลารอชำระเงิน (5 นาที)
  static async cleanupExpiredOrdersLegacy() {
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      // หา Order ที่มีสถานะ "รอชำระเงิน" และสร้างมาเกิน 5 นาที
      const expiredOrders = await OrderModel.find({
        orderStatus: 'รอชำระเงิน',
        'stripePayment.paymentStatus': 'pending',
        createdAt: { $lt: fiveMinutesAgo }
      });
      
      if (expiredOrders.length > 0) {
        console.log(`Found ${expiredOrders.length} expired orders, cleaning up...`);
        
        for (const order of expiredOrders) {
          try {
            // ❌ ไม่ต้องคืนสต็อกเพราะยังไม่ได้ตัดตอนสร้าง Order
            // ❌ ไม่ต้องเคลียร์ตะกร้าเพราะยังไม่ได้เคลียร์ตอนสร้าง Order
            
            // ลบ Order
            await OrderModel.findByIdAndDelete(order._id);
            console.log(`Deleted expired order: ${order._id}`);
            
          } catch (error) {
            console.error(`Error cleaning up expired order ${order._id}:`, error);
          }
        }
        
        console.log(`Cleanup completed. Deleted ${expiredOrders.length} expired orders.`);
      }
      
      return expiredOrders.length;
    } catch (error) {
      console.error('Cleanup expired orders error:', error);
      throw error;
    }
  }

  // ✅ ฟังก์ชันตั้งเวลาลบ Order อัตโนมัติ
  static scheduleOrderCleanup() {
    // ตั้งเวลาลบ Order ทุก 1 นาที
    setInterval(async () => {
      try {
        await this.cleanupExpiredOrders();
      } catch (error) {
        console.error('Scheduled cleanup error:', error);
      }
    }, 60 * 1000); // 1 นาที
    
    console.log('Order cleanup scheduler started - checking every 1 minute');
  }

  // จัดการการชำระเงินล้มเหลว
  static async handleFailedPayment(paymentIntent) {
    try {
      console.log('🔄 Handling failed payment:', {
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        metadata: paymentIntent.metadata,
        timestamp: new Date().toISOString()
      });

      // ✅ สำหรับ PromptPay ที่ไม่มีการสร้าง Order ตอนสร้าง QR Code
      // ไม่ต้องหาอะไรยกเลิก เพราะยังไม่มี Order
      console.log('⏳ No order to cancel for failed PromptPay payment - order not yet created');
      
      // ✅ อัปเดต metadata เพื่อป้องกันการประมวลผลซ้ำ
      try {
        await stripe.paymentIntents.update(paymentIntent.id, {
          metadata: { 
            ...paymentIntent.metadata, 
            processed: 'true',
            failedAt: new Date().toISOString(),
            failureReason: 'การชำระเงินล้มเหลว - ธนาคารปฏิเสธ'
          }
        });
        console.log('✅ Payment intent metadata updated for failed payment');
      } catch (updateError) {
        console.error('❌ Failed to update payment intent metadata:', updateError.message);
      }
      
      // ✅ ลบข้อมูลการชำระเงินจาก localStorage (ถ้ามี)
      // ข้อมูลนี้จะถูกลบใน Frontend เมื่อตรวจสอบสถานะ
      console.log('🧹 Failed payment cleanup completed');
      
    } catch (error) {
      console.error('❌ Handle failed payment error:', {
        error: error.message,
        paymentIntentId: paymentIntent.id,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  // สร้าง Order จากข้อมูลตะกร้า (ใช้เมื่อชำระเงินสำเร็จ)
  static async createOrderFromCartData(cartData, paymentIntentId) {
    try {
      const { cartItems, userName, totalAmount } = cartData;
      
      if (!cartItems || cartItems.length === 0) {
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

        // ตัดสต็อกสินค้าแบบ FIFO
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

        // เก็บข้อมูลล็อตที่ใช้ในการขาย
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

      // สร้าง Order ใหม่ด้วย paymentMethod เป็น "BankTransfer"
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
          paymentStatus: 'paid',
          paidAt: new Date()
        }
      });

      const savedOrder = await order.save();

      // เคลียร์ตะกร้าหลังจากสร้าง order สำเร็จ
      await CartModel.deleteMany({ userName: userName });

      console.log(`Order created and cart cleared for user: ${userName}`);
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
      throw error;
    }
  }
}

module.exports = PaymentService;
