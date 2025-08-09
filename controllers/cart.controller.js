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
    const eligibleLots = (product.lots || []).filter(lot => lot.status === 'active' && lot.quantity > 0 && new Date(lot.expirationDate) > now);
    if (eligibleLots.length === 0) {
      return res.status(400).json({ message: 'ไม่มีล็อตสินค้าที่พร้อมขาย (อาจหมดอายุหรือหมดสต็อก)' });
    }

    // ตรวจสอบจำนวนสินค้าในสต็อก (ใช้ totalQuantity)
    const requestedQuantity = pack ? quantity * product.packSize : quantity;
    if (requestedQuantity > product.totalQuantity) {
      return res.status(400).json({ 
        message: `ไม่สามารถเพิ่มสินค้าได้ จำนวนสินค้าคงเหลือ ${product.totalQuantity} ${pack ? 'แพ็ค' : 'ชิ้น'}`
      });
    }

    // กำหนดราคาตามว่า pack เป็น true หรือไม่
    const price = pack ? product.sellingPricePerPack : product.sellingPricePerUnit;

    // ค้นหาสินค้าในตะกร้าของผู้ใช้ โดยแยกตาม barcode และ promotionId
    const existingItem = await CartModel.findOne({ productId, userName: currentUsername, barcode: barcode || (pack ? product.barcodePack : product.barcodeUnit), promotionId: promotionId || null });

    if (existingItem) {
      // ตรวจสอบจำนวนรวมที่จะมีในตะกร้า
      const newTotalQuantity = pack ? 
        (existingItem.quantity + quantity) * product.packSize : 
        existingItem.quantity + quantity;

      if (newTotalQuantity > product.totalQuantity) {
        return res.status(400).json({ 
          message: `ไม่สามารถเพิ่มสินค้าได้ จำนวนสินค้าคงเหลือ ${product.totalQuantity} ${pack ? 'แพ็ค' : 'ชิ้น'}`
        });
      }

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
        promotionId: promotionId || null
    });

    const newItem = await cart.save();
    res.status(201).json(newItem);
  } catch (error) {
    console.error("Error during cart creation:", error);
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
      const eligibleLots = (product.lots || []).filter(lot => lot.status === 'active' && lot.quantity > 0 && new Date(lot.expirationDate) > now);
      if (eligibleLots.length === 0) {
        return res.status(400).json({ message: 'ไม่มีล็อตสินค้าที่พร้อมขาย (อาจหมดอายุหรือหมดสต็อก)' });
      }

      // ตรวจสอบจำนวนสินค้าในสต็อก (ใช้ totalQuantity) โดยคำนวณตาม pack ที่มีผลจริง
      const effectivePack = (pack !== undefined) ? pack : cart.pack;
      const effectiveQuantity = (quantity !== undefined) ? quantity : cart.quantity;
      const requestedQuantity = effectivePack ? effectiveQuantity * product.packSize : effectiveQuantity;
      if (requestedQuantity > product.totalQuantity) {
        return res.status(400).json({ 
          message: `ไม่สามารถอัพเดทสินค้าได้ จำนวนสินค้าคงเหลือ ${product.totalQuantity} หน่วย`
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
          if (mergedQuantityUnits > product.totalQuantity) {
            return res.status(400).json({
              message: `ไม่สามารถรวมรายการได้ เนื่องจากจำนวนรวมเกินสต็อก (${product.totalQuantity} หน่วย)`
            });
          }
          cart.quantity = cart.quantity + duplicate.quantity;
          await duplicate.deleteOne();
        }
      }

      const updatedCart = await cart.save();
      res.json(updatedCart);
    } catch (error) {
      console.error("Error updating cart:", error);
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
    console.log("Received data:", req.body);

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
          const eligibleLots = (product.lots || []).filter(l => l.status === 'active' && l.quantity > 0 && new Date(l.expirationDate) > now && promotion.appliedLots.includes(l.lotNumber));
          if (eligibleLots.length === 0) return res.status(400).json({ message: "ไม่มีล็อตที่ใช้โปรโมชันนี้ได้ในขณะนี้" });
          promoAvailableQty = eligibleLots.reduce((sum, l) => sum + l.quantity, 0);
        }

        const pack = false; // โปรฯ ขายต่อชิ้นเท่านั้น
        const requestedQuantity = quantity;
        if (requestedQuantity > promoAvailableQty) {
          return res.status(400).json({ message: `ไม่สามารถเพิ่มสินค้าโปรโมชันได้ จำนวนที่พร้อมขายสำหรับโปรฯ มีเพียง ${promoAvailableQty} หน่วย` });
        }
        const price = promotion.discountedPrice;

        const existingItem = await CartModel.findOne({ productId: product._id, userName: currentUsername, barcode, promotionId: promotion._id });
        if (existingItem) {
          const newTotalQuantity = existingItem.quantity + quantity;
          if (newTotalQuantity > promoAvailableQty) {
            return res.status(400).json({ message: `ไม่สามารถเพิ่มสินค้าโปรโมชันได้ จำนวนที่พร้อมขายสำหรับโปรฯ มีเพียง ${promoAvailableQty} หน่วย` });
          }
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
          promotionId: promotion._id
        });
        const newItem = await cart.save();
        return res.status(201).json(newItem);
      }

      // 2) บาร์โค้ดสินค้าปกติ (แพ็ค/ชิ้น)
      const product = await ProductModel.findOne({ $or: [{ barcodePack: barcode }, { barcodeUnit: barcode }] });
      if (!product) return res.status(404).json({ message: "Product not found!" });

      const isPack = barcode === product.barcodePack;
      const pack = isPack;
      // ตรวจสอบล็อตที่พร้อมขาย
      const eligibleLots = (product.lots || []).filter(l => l.status === 'active' && l.quantity > 0 && new Date(l.expirationDate) > now);
      if (eligibleLots.length === 0) {
        return res.status(400).json({ message: 'ไม่มีล็อตสินค้าที่พร้อมขาย (อาจหมดอายุหรือหมดสต็อก)' });
      }
      const requestedQuantity = pack ? quantity * product.packSize : quantity;
      if (requestedQuantity > product.totalQuantity) {
        return res.status(400).json({ message: `ไม่สามารถเพิ่มสินค้าได้ จำนวนสินค้าในสต็อกมีเพียง ${product.totalQuantity} ${pack ? 'ชิ้น' : 'หน่วย'}` });
      }
      const price = pack ? product.sellingPricePerPack : product.sellingPricePerUnit;

      const existingItem = await CartModel.findOne({ productId: product._id, userName: currentUsername, barcode, promotionId: null });
      if (existingItem) {
        const newTotalQuantity = pack ? (existingItem.quantity + quantity) * product.packSize : existingItem.quantity + quantity;
        if (newTotalQuantity > product.totalQuantity) {
          return res.status(400).json({ message: `ไม่สามารถเพิ่มสินค้าได้ จำนวนสินค้าในสต็อกมีเพียง ${product.totalQuantity} ${pack ? 'ชิ้น' : 'หน่วย'}` });
        }
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
        promotionId: null
      });
      const newItem = await cart.save();
      return res.status(201).json(newItem);
    } catch (error) {
      console.error("Error during cart creation:", error);
      res.status(500).json({ message: error.message || "Something went wrong!" });
    }
  };
  