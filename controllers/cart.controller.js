const CartModel = require("../models/Cart");
const ProductModel = require("../models/Product");
const PromotionModel = require("../models/Promotion");


exports.getAllCarts = async (req, res) => {
  try {
    // จำกัดผลลัพธ์เฉพาะของผู้ใช้ที่ล็อกอินอยู่
    const currentUsername = req.user?.username;
    const carts = await CartModel.find({ userName: currentUsername });
    res.json(carts);
  } catch (error) {
    res
      .status(500)
      .json({ message: error.message || "Failed to get cart items." });
  }
};

// 📌 POST /carts - เพิ่มสินค้าไปยังตะกร้า
exports.createCart = async (req, res) => {
  try {
    const { productId, quantity, pack, userName, barcode, promotionId } = req.body;
    const currentUsername = req.user?.username;

    // ตรวจสอบข้อมูลที่จำเป็น
    if (!productId || !quantity) {
      return res.status(400).json({ message: 'กรุณาระบุข้อมูลที่จำเป็น' });
    }

    // ป้องกันสวมรอย userName
    if (userName && userName !== currentUsername) {
      return res.status(403).json({ message: 'ไม่สามารถเพิ่มตะกร้าในนามผู้ใช้อื่นได้' });
    }

    // ค้นหาสินค้า
    const product = await ProductModel.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'ไม่พบสินค้า' });
    }

    // ตรวจสอบล็อตที่ใช้งานได้จริง (active + ไม่หมดอายุ + มีสต็อก)
    const now = new Date();
    const allActiveLots = (product.lots || []).filter(lot => 
      lot.status === 'active' && 
      lot.quantity > 0 && 
      (lot.expirationDate ? new Date(lot.expirationDate) > now : true)
    );
    
    // หาล็อตที่ใช้โปรโมชัน โดยค้นหาจาก Promotion model
    const promoUsedLots = new Set();
    let promoAvailableQty = 0;
    let isPromotionProduct = false;
    
    try {
      const activePromotions = await PromotionModel.find({
        productId: product._id,
        validityStart: { $lte: now },//lteคือ น้อยกว่าหรือเท่ากับ
        validityEnd: { $gte: now }//gteคือ มากกว่าหรือเท่ากับ
      });
      
      for (const promo of activePromotions) {
        if (promo.appliedLots && Array.isArray(promo.appliedLots)) {
          promo.appliedLots.forEach(lotNumber => promoUsedLots.add(lotNumber));
        }
      }
      
      // ถ้ามี promotionId แสดงว่าเป็นสินค้าโปรโมชัน
      if (promotionId) {
        const currentPromo = activePromotions.find(p => p._id.toString() === promotionId);
        if (currentPromo && currentPromo.appliedLots && Array.isArray(currentPromo.appliedLots)) {
          isPromotionProduct = true;
          const eligibleLots = allActiveLots.filter(lot => currentPromo.appliedLots.includes(lot.lotNumber));
          promoAvailableQty = eligibleLots.reduce((sum, lot) => sum + lot.quantity, 0);
        }
      }
    } catch (error) {
      // Error fetching promotions - handled silently
    }
    
    // ล็อตที่ขายได้แบบปกติ (ไม่ใช่ล็อตที่ใช้โปรโมชัน)
    const normalSaleLots = allActiveLots.filter(lot => !promoUsedLots.has(lot.lotNumber));
    
    // ตรวจสอบจำนวนสินค้าในสต็อก
    let availableQuantity;
    let stockMessage;
    
    if (isPromotionProduct) {
      // สำหรับสินค้าโปรโมชัน ใช้จำนวนจากล็อตที่กำหนด
      availableQuantity = promoAvailableQty;
      stockMessage = `จำนวนสินค้าโปรโมชันที่พร้อมขายมีเพียง ${availableQuantity} ชิ้น`;
    } else {
      // สำหรับสินค้าปกติ ใช้จำนวนจากล็อตที่ไม่ได้ใช้โปรโมชัน
      if (normalSaleLots.length === 0) {
        return res.status(400).json({ message: 'ไม่มีล็อตสินค้าที่พร้อมขายแบบปกติ (ล็อตทั้งหมดถูกใช้ในโปรโมชัน)' });
      }
      availableQuantity = normalSaleLots.reduce((sum, lot) => sum + lot.quantity, 0);
      stockMessage = `จำนวนสินค้าที่ขายได้แบบปกติมีเพียง ${availableQuantity} ชิ้น`;
    }
    
    const requestedQuantity = pack ? quantity * product.packSize : quantity;
    if (requestedQuantity > availableQuantity) {
      return res.status(400).json({ 
        message: `ไม่สามารถเพิ่มสินค้าได้ ${stockMessage}` 
      });
    }

    // กำหนดราคาตามว่าเป็นสินค้าโปรโมชันหรือไม่
    let price;
    if (promotionId) {
      // ถ้ามี promotionId ให้ใช้ราคาโปรโมชัน
      try {
        const promotion = await PromotionModel.findById(promotionId);
        if (promotion) {
          price = promotion.discountedPrice;
        } else {
          // ถ้าไม่พบโปรโมชัน ให้ใช้ราคาปกติ
          price = pack ? product.sellingPricePerPack : product.sellingPricePerUnit;
        }
      } catch (error) {
        // ถ้าเกิดข้อผิดพลาด ให้ใช้ราคาปกติ
        price = pack ? product.sellingPricePerPack : product.sellingPricePerUnit;
      }
    } else {
      // ถ้าไม่มี promotionId ให้ใช้ราคาปกติ
      price = pack ? product.sellingPricePerPack : product.sellingPricePerUnit;
    }

    // ตรวจสอบจำนวนรวมของสินค้าชิ้นเดียวกันในตะกร้า (รวมทั้งแพ็คและชิ้น)
    const allCartItemsForProduct = await CartModel.find({ 
      productId, 
      userName: currentUsername, 
      promotionId: promotionId || null 
    });
    
    // คำนวณจำนวนชิ้นรวมที่อยู่ในตะกร้าแล้ว
    const totalCartQuantity = allCartItemsForProduct.reduce((sum, cartItem) => {
      return sum + (cartItem.pack ? cartItem.quantity * cartItem.packSize : cartItem.quantity);
    }, 0);
    
    // ตรวจสอบว่าจำนวนใหม่จะเกินสต็อกหรือไม่
    const newTotalQuantity = totalCartQuantity + (pack ? quantity * product.packSize : quantity);
    if (newTotalQuantity > availableQuantity) {
      return res.status(400).json({ 
        message: `ไม่สามารถเพิ่มสินค้าได้ ${stockMessage} (ในตะกร้ามี ${totalCartQuantity} ชิ้นแล้ว) - จำนวนที่ขอ: ${pack ? quantity + ' แพ็ค (' + (quantity * product.packSize) + ' ชิ้น)' : quantity + ' ชิ้น'}` 
      });
    }

    // ค้นหาสินค้าในตะกร้าของผู้ใช้ โดยแยกตาม barcode และ promotionId
    const existingItem = await CartModel.findOne({ productId, userName: currentUsername, barcode: barcode || (pack ? product.barcodePack : product.barcodeUnit), promotionId: promotionId || null });

    if (existingItem) {
      // ถ้าพบสินค้าในตะกร้าแล้ว ให้เพิ่มจำนวนสินค้า
      existingItem.quantity += quantity;
      const updatedItem = await existingItem.save();
      return res.json(updatedItem);
    }

    // ถ้าไม่พบสินค้าในตะกร้า ให้สร้างรายการใหม่
      const cart = new CartModel({
      productId,
      name: product.productName,
      price,
      image: product.productImage,
      quantity,
      userName: currentUsername,
        pack,
        barcode: barcode || (pack ? product.barcodePack : product.barcodeUnit),
        promotionId: promotionId || null,
        packSize: product.packSize || 1
    });

    const newItem = await cart.save();
    res.status(201).json(newItem);
  } catch (error) {
    res.status(500).json({ message: error.message || "Something went wrong!" });
  }
};


  
  exports.getCartsByUserName = async (req, res) => {

  try {
    const { userName } = req.params;
    const currentUsername = req.user?.username;
    if (userName !== currentUsername) {
      return res.status(403).json({ message: 'ไม่ได้รับอนุญาต' });
    }
    const carts = await CartModel.find({ userName });
    res.json(carts);
  } catch (error) {
    res
      .status(500)
      .json({ message: error.message || "Failed to get cart items." });
  }
};

  
  // 📌 DELETE /cart/{userId} - ลบสินค้าทั้งหมดในตะกร้าของผู้ใช้
exports.deleteAllCarts = async (req, res) => {
    const { userName  } = req.params;
    const currentUsername = req.user?.username;
    if (userName !== currentUsername) {
      return res.status(403).json({ message: 'ไม่ได้รับอนุญาต' });
    }
    try {
      const result = await CartModel.deleteMany({ userName });
  
      if (result.deletedCount > 0) {
        return res.json({ message: "All cart items removed!" });
      } else {
        return res.json({ message: "No cart items found." });
      }
    } catch (error) {
      res.status(500).json({ message: error.message || "Failed to delete cart items." });
    }
  };
  
  exports.updateCartById = async (req, res) => {
    try {
      const { id } = req.params;
      const { quantity, pack } = req.body;

      // ตรวจสอบว่ามีการส่ง quantity หรือ pack มาหรือไม่
      if (quantity === undefined && pack === undefined) {
        return res.status(400).json({ message: 'กรุณาระบุจำนวนหรือประเภทการขาย' });
      }

      // ค้นหาสินค้าในตะกร้า
      const cart = await CartModel.findById(id);
      if (!cart) {
        return res.status(404).json({ message: 'ไม่พบสินค้าในตะกร้า' });
      }

      // อนุญาตเฉพาะเจ้าของรายการ
      const currentUsername = req.user?.username;
      if (cart.userName !== currentUsername) {
        return res.status(403).json({ message: 'ไม่ได้รับอนุญาต' });
      }

      // ค้นหาสินค้าเพื่อตรวจสอบสต็อก
      const product = await ProductModel.findById(cart.productId);
      if (!product) {
        return res.status(404).json({ message: 'ไม่พบสินค้า' });
      }

      // ป้องกันสลับเป็นแพ็คในกรณีรายการมีโปรโมชัน (โปรฯ ถูกกำหนดให้ขายต่อชิ้นเท่านั้นด้าน add-with-barcode)
      if (cart.promotionId && pack !== undefined && pack === true) {
        return res.status(400).json({ message: 'ไม่สามารถเปลี่ยนเป็นแพ็คสำหรับรายการโปรโมชันได้' });
      }

      // ตรวจสอบล็อตที่พร้อมขาย
      const now = new Date();
      const allActiveLots = (product.lots || []).filter(lot => 
        lot.status === 'active' && 
        lot.quantity > 0 && 
        (lot.expirationDate ? new Date(lot.expirationDate) > now : true)
      );
      
      // หาล็อตที่ใช้โปรโมชัน และคำนวณจำนวนที่ใช้ได้
      const promoUsedLots = new Set();
      let availableQuantity = 0;
      
      try {
        const activePromotions = await PromotionModel.find({
          productId: product._id,
          validityStart: { $lte: now },
          validityEnd: { $gte: now }
        });
        
        for (const promo of activePromotions) {
          if (promo.appliedLots && Array.isArray(promo.appliedLots)) {
            promo.appliedLots.forEach(lotNumber => promoUsedLots.add(lotNumber));
          }
        }
        
        // ถ้ารายการในตะกร้ามีโปรโมชัน ให้ใช้จำนวนจากล็อตที่กำหนด
        if (cart.promotionId) {
          const currentPromo = activePromotions.find(p => p._id.toString() === cart.promotionId.toString());
          if (currentPromo && currentPromo.appliedLots && Array.isArray(currentPromo.appliedLots)) {
            const eligibleLots = allActiveLots.filter(lot => currentPromo.appliedLots.includes(lot.lotNumber));
            availableQuantity = eligibleLots.reduce((sum, lot) => sum + lot.quantity, 0);
          }
        } else {
          // สำหรับสินค้าปกติ ใช้จำนวนจากล็อตที่ไม่ได้ใช้โปรโมชัน
          const normalSaleLots = allActiveLots.filter(lot => !promoUsedLots.has(lot.lotNumber));
          if (normalSaleLots.length === 0) {
            return res.status(400).json({ message: 'ไม่มีล็อตสินค้าที่พร้อมขายแบบปกติ (ล็อตทั้งหมดถูกใช้ในโปรโมชัน)' });
          }
          availableQuantity = normalSaleLots.reduce((sum, lot) => sum + lot.quantity, 0);
        }
      } catch (error) {
        // Error fetching promotions - handled silently
      }

      // ตรวจสอบจำนวนรวมของสินค้าชิ้นเดียวกันในตะกร้า (รวมทั้งแพ็คและชิ้น)
      const effectivePack = (pack !== undefined) ? pack : cart.pack;
      const effectiveQuantity = (quantity !== undefined) ? quantity : cart.quantity;
      
      // คำนวณจำนวนชิ้นรวมที่จะมีในตะกร้าหลังอัปเดต
      const requestedQuantity = effectivePack ? effectiveQuantity * product.packSize : effectiveQuantity;
      
      // ตรวจสอบจำนวนรวมของสินค้าชิ้นเดียวกันในตะกร้าอื่นๆ (ไม่รวมรายการปัจจุบัน)
      const otherCartItemsForProduct = await CartModel.find({ 
        productId: cart.productId, 
        userName: currentUsername, 
        promotionId: cart.promotionId || null,
        _id: { $ne: cart._id } // ไม่รวมรายการปัจจุบัน
      });
      
      // คำนวณจำนวนชิ้นรวมที่อยู่ในตะกร้าอื่นๆ แล้ว
      const otherCartQuantity = otherCartItemsForProduct.reduce((sum, cartItem) => {
        return sum + (cartItem.pack ? cartItem.quantity * cartItem.packSize : cartItem.quantity);
      }, 0);
      
      // ตรวจสอบว่าจำนวนรวมจะเกินสต็อกหรือไม่
      const totalRequestedQuantity = otherCartQuantity + requestedQuantity;
      if (totalRequestedQuantity > availableQuantity) {
        const stockMessage = cart.promotionId ? 
          `จำนวนสินค้าโปรโมชันที่พร้อมขายมีเพียง ${availableQuantity} ชิ้น` :
          `จำนวนสินค้าที่ขายได้แบบปกติมีเพียง ${availableQuantity} ชิ้น`;
        
        return res.status(400).json({ 
          message: `ไม่สามารถอัพเดทสินค้าได้ ${stockMessage} (ในตะกร้ามี ${otherCartQuantity} ชิ้นแล้ว) - จำนวนที่ขอ: ${effectivePack ? effectiveQuantity + ' แพ็ค (' + (effectiveQuantity * product.packSize) + ' ชิ้น)' : effectiveQuantity + ' ชิ้น'}` 
        });
      }

      // อัพเดทข้อมูลจำนวนและประเภทแพ็ค พร้อมอัพเดทราคา/บาร์โค้ดให้สอดคล้อง
      if (quantity !== undefined) {
        if (quantity <= 0) {
          return res.status(400).json({ message: 'จำนวนต้องมากกว่า 0' });
        }
        cart.quantity = quantity;
      }
      if (pack !== undefined) {
        cart.pack = pack;
        cart.price = pack ? product.sellingPricePerPack : product.sellingPricePerUnit;
        cart.barcode = pack ? product.barcodePack : product.barcodeUnit;

        // รวมบรรทัดซ้ำ (merge) ถ้ามีรายการอื่นของผู้ใช้เดียวกันที่ key ชนกัน
        const duplicate = await CartModel.findOne({
          _id: { $ne: cart._id },
          userName: cart.userName,
          productId: cart.productId,
          barcode: cart.barcode,
          promotionId: cart.promotionId || null,
        });
        if (duplicate) {
          // ตรวจสอบรวมจำนวนหลัง merge ว่าเกินสต็อกหรือไม่
          const mergedQuantityUnits = cart.pack
            ? (cart.quantity + duplicate.quantity) * product.packSize
            : (cart.quantity + duplicate.quantity);
          
          if (mergedQuantityUnits > availableQuantity) {
            const stockMessage = cart.promotionId ? 
              `จำนวนสินค้าโปรโมชันที่พร้อมขาย (${availableQuantity} ชิ้น)` :
              `จำนวนสินค้าที่ขายได้แบบปกติ (${availableQuantity} ชิ้น)`;
            
            return res.status(400).json({
              message: `ไม่สามารถรวมรายการได้ เนื่องจากจำนวนรวมเกินสต็อก - ${stockMessage}`
            });
          }
          cart.quantity = cart.quantity + duplicate.quantity;
          await duplicate.deleteOne();
        }
      }

      const updatedCart = await cart.save();
      res.json(updatedCart);
    } catch (error) {
      res.status(500).json({ message: error.message || "Something went wrong!" });
    }
  };
  
  
  // 📌 DELETE /cart/{id} - ลบสินค้าตาม ID
exports.deleteCartById = async (req, res) => {
    try {
      const { id } = req.params;
      const currentUsername = req.user?.username;
      const item = await CartModel.findById(id);
      if (!item) {
        return res.status(404).json({ message: "Item not found!" });
      }
      if (item.userName !== currentUsername) {
        return res.status(403).json({ message: 'ไม่ได้รับอนุญาต' });
      }
      await item.deleteOne();
      res.status(200).json({ message: "Item deleted successfully!" });
    } catch (error) {
      res.status(500).json({ message: error.message || "Failed to delete cart item." });
    }
  };
  
  exports.createCartWithBarcode = async (req, res) => {
    const { barcode, quantity, userName } = req.body;
    const currentUsername = req.user?.username;

    if (!barcode || !quantity) {
      return res.status(400).json({ message: "Product information is missing!" });
    }
    if (userName && userName !== currentUsername) {
      return res.status(403).json({ message: 'ไม่ได้รับอนุญาต' });
    }

    try {
      const now = new Date();
      // 1) บาร์โค้ดโปรโมชัน
      const promotion = await PromotionModel.findOne({ barcode }).lean();
      if (promotion) {
        if (!(new Date(promotion.validityStart) <= now && now <= new Date(promotion.validityEnd))) {
          return res.status(400).json({ message: "โปรโมชันนี้หมดอายุหรือยังไม่เริ่ม" });
        }
        const product = await ProductModel.findById(promotion.productId);
        if (!product) return res.status(404).json({ message: "Product not found!" });

        let promoAvailableQty = product.totalQuantity; // fallback ทั้งหมด
        if (Array.isArray(promotion.appliedLots) && promotion.appliedLots.length > 0) {
          const eligibleLots = (product.lots || []).filter(l => 
            l.status === 'active' && 
            l.quantity > 0 && 
            (l.expirationDate ? new Date(l.expirationDate) > now : true) && 
            promotion.appliedLots.includes(l.lotNumber)
          );
          if (eligibleLots.length === 0) return res.status(400).json({ message: "ไม่มีล็อตที่ใช้โปรโมชันนี้ได้ในขณะนี้" });
          promoAvailableQty = eligibleLots.reduce((sum, l) => sum + l.quantity, 0);
        }

        const pack = false; // โปรฯ ขายต่อชิ้นเท่านั้น
        const requestedQuantity = quantity;
        if (requestedQuantity > promoAvailableQty) {
          return res.status(400).json({ message: `ไม่สามารถเพิ่มสินค้าโปรโมชันได้ จำนวนที่พร้อมขายสำหรับโปรฯ มีเพียง ${promoAvailableQty} หน่วย` });
        }
        const price = promotion.discountedPrice;

        // ตรวจสอบสินค้าโปรโมชันในตะกร้า โดยใช้บาร์โค้ดสินค้าจริง (ไม่ใช่บาร์โค้ดโปรโมชัน)
        const existingItem = await CartModel.findOne({ 
          productId: product._id, 
          userName: currentUsername, 
          barcode: product.barcodeUnit, // ใช้บาร์โค้ดสินค้าจริง
          promotionId: promotion._id 
        });
        if (existingItem) {
          const newTotalQuantity = existingItem.quantity + quantity;
          if (newTotalQuantity > promoAvailableQty) {
            return res.status(400).json({ message: `ไม่สามารถเพิ่มสินค้าโปรโมชันได้ จำนวนที่พร้อมขายสำหรับโปรฯ มีเพียง ${promoAvailableQty} หน่วย` });
          }
          // อัปเดตจำนวนและราคาโปรโมชันปัจจุบัน
          existingItem.quantity += quantity;
          existingItem.price = promotion.discountedPrice; // อัปเดตราคาโปรโมชันปัจจุบัน
          const updatedItem = await existingItem.save();
          return res.json(updatedItem);
        }

        const cart = new CartModel({
          productId: product._id,
          name: product.productName,
          price,
          image: product.productImage,
          quantity,
          userName: currentUsername,
          pack,
          barcode: product.barcodeUnit, // ใช้บาร์โค้ดสินค้าจริง แทนบาร์โค้ดโปรโมชัน
          promotionId: promotion._id,
          packSize: product.packSize || 1
        });
        const newItem = await cart.save();
        return res.status(201).json(newItem);
      }

      // 2) บาร์โค้ดสินค้าปกติ (แพ็ค/ชิ้น)
      const product = await ProductModel.findOne({ $or: [{ barcodePack: barcode }, { barcodeUnit: barcode }] });
      if (!product) return res.status(404).json({ message: "Product not found!" });

      const isPack = barcode === product.barcodePack;
      const pack = isPack;
      
      // ตรวจสอบล็อตที่พร้อมขายแบบปกติ (ไม่ใช่ล็อตที่ใช้โปรโมชัน)
      const allActiveLots = (product.lots || []).filter(l => 
        l.status === 'active' && 
        l.quantity > 0 && 
        (l.expirationDate ? new Date(l.expirationDate) > now : true)
      );
      
      // หาล็อตที่ใช้โปรโมชัน โดยค้นหาจาก Promotion model
      const promoUsedLots = new Set();
      try {
        const activePromotions = await PromotionModel.find({
          productId: product._id,
          validityStart: { $lte: now },
          validityEnd: { $gte: now }
        });
        
        for (const promo of activePromotions) {
          if (promo.appliedLots && Array.isArray(promo.appliedLots)) {
            promo.appliedLots.forEach(lotNumber => promoUsedLots.add(lotNumber));
          }
        }
      } catch (error) {
        // Error fetching promotions - handled silently
      }
      
      // ล็อตที่ขายได้แบบปกติ (ไม่ใช่ล็อตที่ใช้โปรโมชัน)
      const normalSaleLots = allActiveLots.filter(lot => !promoUsedLots.has(lot.lotNumber));
      
      if (normalSaleLots.length === 0) {
        return res.status(400).json({ message: 'ไม่มีล็อตสินค้าที่พร้อมขายแบบปกติ (ล็อตทั้งหมดถูกใช้ในโปรโมชัน)' });
      }
      
      // คำนวณจำนวนสินค้าที่ขายได้แบบปกติ
      const normalSaleQuantity = normalSaleLots.reduce((sum, lot) => sum + lot.quantity, 0);
      
      const requestedQuantity = pack ? quantity * product.packSize : quantity;
      if (requestedQuantity > normalSaleQuantity) {
        return res.status(400).json({ 
          message: `ไม่สามารถเพิ่มสินค้าได้ จำนวนสินค้าที่ขายได้แบบปกติมีเพียง ${normalSaleQuantity} ชิ้น (ล็อตที่ใช้โปรโมชันไม่สามารถขายได้แบบปกติ)` 
        });
      }
      
      const price = pack ? product.sellingPricePerPack : product.sellingPricePerUnit;

      // ตรวจสอบจำนวนรวมของสินค้าชิ้นเดียวกันในตะกร้า (รวมทั้งแพ็คและชิ้น)
      const allCartItemsForProduct = await CartModel.find({ 
        productId: product._id, 
        userName: currentUsername, 
        promotionId: null 
      });
      
      // คำนวณจำนวนชิ้นรวมที่อยู่ในตะกร้าแล้ว
      const totalCartQuantity = allCartItemsForProduct.reduce((sum, cartItem) => {
        return sum + (cartItem.pack ? cartItem.quantity * cartItem.packSize : cartItem.quantity);
      }, 0);
      
      // ตรวจสอบว่าจำนวนใหม่จะเกินสต็อกที่ขายได้แบบปกติหรือไม่
      const newTotalQuantity = totalCartQuantity + (pack ? quantity * product.packSize : quantity);
      if (newTotalQuantity > normalSaleQuantity) {
        return res.status(400).json({ 
          message: `ไม่สามารถเพิ่มสินค้าได้ จำนวนสินค้าที่ขายได้แบบปกติมีเพียง ${normalSaleQuantity} ชิ้น (ในตะกร้ามี ${totalCartQuantity} ชิ้นแล้ว) - จำนวนที่ขอ: ${pack ? quantity + ' แพ็ค (' + (quantity * product.packSize) + ' ชิ้น)' : quantity + ' ชิ้น'}` 
        });
      }

      const existingItem = await CartModel.findOne({ productId: product._id, userName: currentUsername, barcode, promotionId: null });
      if (existingItem) {
        existingItem.quantity += quantity;
        const updatedItem = await existingItem.save();
        return res.json(updatedItem);
      }

      const cart = new CartModel({
        productId: product._id,
        name: product.productName,
        price,
        image: product.productImage,
        quantity,
        userName: currentUsername,
        pack,
        barcode,
        promotionId: null,
        packSize: product.packSize || 1
      });
      const newItem = await cart.save();
      return res.status(201).json(newItem);
    } catch (error) {
      res.status(500).json({ message: error.message || "Something went wrong!" });
    }
  };
  