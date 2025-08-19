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
        userName: userName,
        cartDataLength: cartData ? cartData.length : 0
      });
      
      if (cartData && userName) {
        try {
          console.log('📝 Parsing cart data...');
          const parsedCartData = JSON.parse(cartData);
          console.log('✅ Cart data parsed successfully:', {
            itemCount: parsedCartData.cartItems?.length,
            totalAmount: parsedCartData.totalAmount,
            userName: parsedCartData.userName,
            cartItems: parsedCartData.cartItems?.map(item => ({
              productName: item.productName,
              quantity: item.quantity,
              price: item.price
            }))
          });
          
          console.log('🏗️ Creating order from cart data...');
          const order = await this.createOrderFromCartData(parsedCartData, paymentIntent.id);
          
          if (order) {
            console.log('✅ Order created successfully:', order._id);
            console.log('📊 Order details:', {
              orderId: order._id,
              userName: order.userName,
              totalAmount: order.total,
              orderStatus: order.orderStatus,
              productCount: order.products?.length
            });
            
            // อัปเดต metadata เพื่อป้องกันการประมวลผลซ้ำ
            console.log('🔧 Updating payment intent metadata...');
            try {
              await stripe.paymentIntents.update(paymentIntent.id, {
                metadata: { 
                  ...paymentIntent.metadata, 
                  processed: 'true',
                  orderId: order._id.toString()
                }
              });
              console.log('✅ Metadata updated successfully');
            } catch (updateError) {
              console.error('⚠️ Failed to update metadata:', updateError.message);
              // ไม่ throw error เพราะ Order ถูกสร้างแล้ว
            }
            
            console.log(`🎉 Order creation completed: ${order._id} for user: ${userName}`);
            return order;
          } else {
            console.error('❌ Order creation returned null');
            console.error('❌ Cart data used:', parsedCartData);
          }
        } catch (parseError) {
          console.error('❌ Error parsing cart data:', parseError);
          console.error('❌ Raw cart data:', cartData);
          console.error('❌ Parse error stack:', parseError.stack);
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
      console.error('❌ Payment intent that caused error:', {
        id: paymentIntent.id,
        status: paymentIntent.status,
        metadata: paymentIntent.metadata
      });
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
      console.log('🔴 Processing failed payment for:', paymentIntent.id);
      console.log('📋 Payment intent metadata:', paymentIntent.metadata);
      
      const orderId = paymentIntent.metadata?.orderId;
      
      if (orderId && orderId !== 'unknown') {
        console.log('🔍 Looking for order with ID:', orderId);
        
        // ✅ ตรวจสอบว่า orderId เป็น MongoDB ObjectId ที่ถูกต้อง
        if (!this.isValidObjectId(orderId)) {
          console.error('❌ Invalid orderId format:', orderId);
          console.error('❌ Expected MongoDB ObjectId format (24 hex characters)');
          return;
        }
        
        // หา Order จากฐานข้อมูล
        const order = await OrderModel.findById(orderId);
        if (order && order.stripePayment && order.stripePayment.paymentIntentId) {
          console.log('✅ Found order, updating payment status...');
          await this.updateOrderPaymentStatus(orderId, order.stripePayment.paymentIntentId, 'unpaid', {
            failureReason: 'การชำระเงินล้มเหลว'
          });
          console.log(`✅ Payment failed status updated for order: ${orderId}`);
        } else {
          console.log(`⚠️ Order not found or no stripe payment info: ${orderId}`);
        }
        
        console.log(`🔴 Payment failed processing completed for order: ${orderId}`);
      } else {
        console.log('⚠️ No valid orderId in payment intent metadata');
      }
    } catch (error) {
      console.error('❌ Handle failed payment error:', error);
      console.error('🔍 Error details:', {
        errorType: error.name,
        errorMessage: error.message,
        paymentIntentId: paymentIntent.id,
        metadata: paymentIntent.metadata
      });
      // ไม่ throw error เพื่อไม่ให้ webhook ล้มเหลว
    }
  }

  // ✅ ฟังก์ชันตรวจสอบ MongoDB ObjectId
  static isValidObjectId(id) {
    if (!id || typeof id !== 'string') {
      return false;
    }
    
    // MongoDB ObjectId ต้องเป็น 24 ตัวอักษร hex string
    const objectIdPattern = /^[0-9a-fA-F]{24}$/;
    return objectIdPattern.test(id);
  }

  // ✅ สร้าง Order จากข้อมูลตะกร้า (ใช้เมื่อชำระเงินสำเร็จเท่านั้น)
  static async createOrderFromCartData(cartData, paymentIntentId) {
    try {
      const { cartItems, userName, totalAmount } = cartData;
      
      console.log('🏗️ Starting order creation with:', {
        cartItemsCount: cartItems?.length,
        userName: userName,
        totalAmount: totalAmount,
        paymentIntentId: paymentIntentId
      });
      
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

      console.log(`✅ Validation passed. Creating order for user: ${userName}, items: ${cartItems.length}, total: ${totalAmount}`);

      // ✅ ตรวจสอบว่าสินค้าในสต็อกเพียงพอหรือไม่ - แก้ไขให้ใช้ _id แทน productId
      for (const item of cartItems) {
        console.log(`🔍 Checking stock for product: ${item.productName || item.name}`);
        console.log(`🔍 Product ID from cart: ${item._id || item.productId}`);
        
        // ✅ ใช้ _id เป็นหลัก เพราะนี่คือ productId ที่ถูกต้อง
        const productId = item._id || item.productId;
        if (!productId) {
          throw new Error(`Product ID not found for ${item.productName || item.name}`);
        }
        
        const product = await ProductModel.findById(productId);
        if (!product) {
          throw new Error(`Product with ID ${productId} (${item.productName || item.name}) not found in database`);
        }

        let requiredQuantity = item.quantity;
        if (item.pack) {
          requiredQuantity *= product.packSize;
        }

        console.log(`📦 Stock check: ${item.productName} (ID: ${productId}) - Required: ${requiredQuantity}, Available: ${product.totalQuantity}`);

        if (product.totalQuantity < requiredQuantity) {
          throw new Error(`Not enough stock for ${item.productName || item.name}. Available: ${product.totalQuantity}, Required: ${requiredQuantity}`);
        }
      }

      console.log('✅ Stock validation passed for all products');

      // ✅ เพิ่มการ debug ข้อมูล cartItems
      console.log('🔍 Cart items structure:', cartItems.map(item => ({
        _id: item._id,
        productId: item.productId,
        productName: item.productName || item.name,
        quantity: item.quantity
      })));

      // คำนวณราคาทั้งหมดและโปรโมชั่น
      let subtotal = 0;
      let totalDiscount = 0;
      const products = [];
      const appliedPromotions = [];
      
      for (const item of cartItems) {
        console.log(`💰 Processing pricing for: ${item.productName || item.name}`);
        
        // ✅ ใช้ _id เป็นหลัก เพราะนี่คือ productId ที่ถูกต้อง
        const productId = item._id || item.productId;
        if (!productId) {
          throw new Error(`Product ID not found for ${item.productName || item.name}`);
        }
        
        const currentProduct = await ProductModel.findById(productId);
        if (!currentProduct) {
          throw new Error(`Product with ID ${productId} (${item.productName || item.name}) not found in database`);
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
          if (promoById && promoById.productId?.toString() === productId.toString() && new Date(promoById.validityStart) <= nowDate && nowDate <= new Date(promoById.validityEnd)) {
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
            console.log(`🎉 Applied promotion: ${promoById.promotionName} - Discount: ${itemDiscount}`);
          }
        }

        subtotal += finalPrice * item.quantity;
        products.push({
          productId: productId, // ✅ ใช้ productId ที่ถูกต้อง
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
        
        console.log(`✅ Product processed: ${item.productName} - Qty: ${item.quantity}, Price: ${finalPrice}, Total: ${finalPrice * item.quantity}`);
      }

      const total = subtotal;
      console.log(`💰 Pricing completed - Subtotal: ${subtotal}, Total: ${total}, Discount: ${totalDiscount}`);

      // ✅ สร้าง Order ใหม่ด้วย paymentMethod เป็น "BankTransfer"
      const orderData = {
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
      };
      
      console.log('📝 Creating order with data:', {
        userName: orderData.userName,
        productCount: orderData.products.length,
        total: orderData.total,
        orderStatus: orderData.orderStatus,
        paymentStatus: orderData.stripePayment.paymentStatus
      });

      const order = new OrderModel(orderData);

      // ✅ บันทึก Order ก่อน
      const savedOrder = await order.save();
      console.log(`✅ Order created successfully: ${savedOrder._id}`);

      // ✅ ตัดสต็อกสินค้าหลังจากสร้าง Order สำเร็จ
      try {
        console.log('📦 Starting stock reduction...');
        await this.processStockReduction(savedOrder);
        console.log(`✅ Stock reduction completed for order: ${savedOrder._id}`);
      } catch (stockError) {
        console.error(`❌ Stock reduction failed for order: ${savedOrder._id}:`, stockError);
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
        console.log(`🛒 Clearing cart for user: ${userName}`);
        await CartModel.deleteMany({ userName: userName });
        console.log(`✅ Cart cleared for user: ${userName}`);
      } catch (cartError) {
        console.error(`⚠️ Failed to clear cart for user: ${userName}:`, cartError);
        // ไม่ throw error เพราะ Order ถูกสร้างแล้ว
      }

      console.log(`🎉 Order creation completed successfully: ${savedOrder._id} for user: ${userName}`);
      return savedOrder;
    } catch (error) {
      console.error('❌ Create order from cart data error:', error);
      console.error('🔍 Error stack:', error.stack);
      console.error('📝 Cart data that caused error:', cartData);
      throw error;
    }
  }

  // จัดการการยกเลิกการชำระเงิน
  static async handleCanceledPayment(paymentIntent) {
    try {
      console.log('🟡 Processing canceled payment for:', paymentIntent.id);
      console.log('📋 Payment intent metadata:', paymentIntent.metadata);
      
      const orderId = paymentIntent.metadata?.orderId;
      
      if (orderId && orderId !== 'unknown') {
        console.log('🔍 Looking for order with ID:', orderId);
        
        // ✅ ตรวจสอบว่า orderId เป็น MongoDB ObjectId ที่ถูกต้อง
        if (!this.isValidObjectId(orderId)) {
          console.error('❌ Invalid orderId format:', orderId);
          console.error('❌ Expected MongoDB ObjectId format (24 hex characters)');
          return;
        }
        
        // หา Order จากฐานข้อมูล
        const order = await OrderModel.findById(orderId);
        if (order && order.stripePayment && order.stripePayment.paymentIntentId) {
          console.log('✅ Found order, updating payment status...');
          await this.updateOrderPaymentStatus(orderId, order.stripePayment.paymentIntentId, 'expired');
          console.log(`✅ Payment canceled status updated for order: ${orderId}`);
        } else {
          console.log(`⚠️ Order not found or no stripe payment info: ${orderId}`);
        }
        
        console.log(`🟡 Payment canceled processing completed for order: ${orderId}`);
      } else {
        console.log('⚠️ No valid orderId in payment intent metadata');
      }
    } catch (error) {
      console.error('❌ Handle canceled payment error:', error);
      console.error('🔍 Error details:', {
        errorType: error.name,
        errorMessage: error.message,
        paymentIntentId: paymentIntent.id,
        metadata: paymentIntent.metadata
      });
      // ไม่ throw error เพื่อไม่ให้ webhook ล้มเหลว
    }
  }
}

module.exports = PaymentService;
