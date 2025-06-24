const CartModel = require("../models/Cart");
const ProductModel = require("../models/Product");


exports.getAllCarts = async (req, res) => {
    try {
      const carts = await CartModel.find();
      res.json(carts);
    } catch (error) {
      res
        .status(500)
        .json({ message: error.message || "Failed to get cart items." });
    }
  };

// 📌 POST /carts - เพิ่มสินค้าไปยังตะกร้า
exports.createCart = async (req, res) => {
  const { productId, quantity, userName, pack } = req.body;
  console.log("Received data:", req.body);

  if (!productId || !quantity || !userName || pack === undefined) {
    return res.status(400).json({ message: "Product information is missing!" });
  }

  try {
    // ค้นหาข้อมูลสินค้าโดยใช้ productId
    const product = await ProductModel.findById(productId);
    
    if (!product) {
      return res.status(404).json({ message: "Product not found!" });
    }

    // ตรวจสอบว่าสินค้าหมดอายุหรือไม่
    const now = new Date();
    if (product.expirationDate && product.expirationDate <= now) {
      return res.status(400).json({ message: 'ไม่สามารถเพิ่มสินค้าหมดอายุเข้าตะกร้าได้' });
    }

    // ตรวจสอบจำนวนสินค้าในสต็อก
    const requestedQuantity = pack ? quantity * product.packSize : quantity;
    if (requestedQuantity > product.quantity) {
      return res.status(400).json({ 
        message: `ไม่สามารถเพิ่มสินค้าได้ จำนวนสินค้าคงเหลือ ${product.quantity} ${pack ? 'แพ็ค' : 'ชิ้น'}`
      });
    }

    // กำหนดราคาตามว่า pack เป็น true หรือไม่
    const price = pack ? product.sellingPricePerPack : product.sellingPricePerUnit;

    // ค้นหาสินค้าในตะกร้าของผู้ใช้
    const existingItem = await CartModel.findOne({ productId, userName });

    if (existingItem) {
      // ตรวจสอบจำนวนรวมที่จะมีในตะกร้า
      const newTotalQuantity = pack ? 
        (existingItem.quantity + quantity) * product.packSize : 
        existingItem.quantity + quantity;

      if (newTotalQuantity > product.quantity) {
        return res.status(400).json({ 
          message: `ไม่สามารถเพิ่มสินค้าได้ จำนวนสินค้าคงเหลือ ${product.quantity} ${pack ? 'แพ็ค' : 'ชิ้น'}`
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
      userName,
      pack
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
    const carts = await CartModel.find({ userName: req.params.userName });
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
      if (!quantity && pack === undefined) {
        return res.status(400).json({ message: 'กรุณาระบุจำนวนหรือประเภทการขาย' });
      }

      // ค้นหาสินค้าในตะกร้า
      const cart = await CartModel.findById(id);
      if (!cart) {
        return res.status(404).json({ message: 'ไม่พบสินค้าในตะกร้า' });
      }

      // ค้นหาสินค้า
      const product = await ProductModel.findById(cart.productId);
      if (!product) {
        return res.status(404).json({ message: 'ไม่พบสินค้า' });
      }

      // ตรวจสอบว่าสินค้าหมดอายุหรือไม่
      const now = new Date();
      if (product.expirationDate && product.expirationDate <= now) {
        return res.status(400).json({ message: 'ไม่สามารถเพิ่มสินค้าหมดอายุเข้าตะกร้าได้' });
      }

      // คำนวณจำนวนที่ต้องการ
      let requestedQuantity = quantity;
      if (pack !== undefined) {
        // ถ้าเปลี่ยนเป็นแพ็ค
        if (pack) {
          // คำนวณจำนวนชิ้นที่ต้องการจากจำนวนแพ็ค
          requestedQuantity = quantity * product.packSize;
        } else {
          // ถ้าเปลี่ยนเป็นชิ้น
          // คำนวณจำนวนชิ้นที่ต้องการจากจำนวนแพ็คเดิม
          requestedQuantity = Math.ceil(quantity / product.packSize);
        }
      }

      // ตรวจสอบจำนวนสินค้า
      if (requestedQuantity > product.quantity) {
        return res.status(400).json({ 
          message: `ไม่สามารถอัพเดทสินค้าได้ จำนวนสินค้าคงเหลือ ${product.quantity} ${pack ? 'ชิ้น' : 'แพ็ค'}`
        });
      }

      // อัพเดทข้อมูล
      const updateData = {};
      if (quantity !== undefined) updateData.quantity = quantity;
      if (pack !== undefined) {
        updateData.pack = pack;
        // อัพเดทราคาตามประเภทการขาย
        updateData.price = pack ? product.sellingPricePerPack : product.sellingPricePerUnit;
      }

      const updatedCart = await CartModel.findByIdAndUpdate(
        id,
        updateData,
        { new: true }
      ).populate('productId');

      res.json(updatedCart);
    } catch (error) {
      console.error('Error updating cart:', error);
      res.status(500).json({ message: 'เกิดข้อผิดพลาดในการอัพเดทตะกร้า' });
    }
  };
  
  
  // 📌 DELETE /cart/{id} - ลบสินค้าตาม ID
exports.deleteCartById = async (req, res) => {
    try {
      const item = await CartModel.findByIdAndDelete(req.params.id);
      if (!item) {
        return res.status(404).json({ message: "Item not found!" });
      }
      res.status(200).json({ message: "Item deleted successfully!" });
    } catch (error) {
      res.status(500).json({ message: error.message || "Failed to delete cart item." });
    }
  };
  
  exports.createCartWithBarcode = async (req, res) => {
    const { barcode, quantity, userName } = req.body;
    console.log("Received data:", req.body);
  
    if (!barcode || !quantity || !userName) {
      return res.status(400).json({ message: "Product information is missing!" });
    }
  
    try {
      // ค้นหาสินค้าจาก barcode (ทั้ง barcodePack หรือ barcodeUnit)
      const product = await ProductModel.findOne({
        $or: [{ barcodePack: barcode }, { barcodeUnit: barcode }]
      });
  
      if (!product) {
        return res.status(404).json({ message: "Product not found!" });
      }

      // ตรวจสอบว่าสินค้าหมดอายุหรือไม่
      const now = new Date();
      if (product.expirationDate && product.expirationDate <= now) {
        return res.status(400).json({ message: 'ไม่สามารถเพิ่มสินค้าหมดอายุเข้าตะกร้าได้' });
      }

      // ตรวจสอบว่า barcode ตรงกับ barcodePack หรือ barcodeUnit
      const isPack = barcode === product.barcodePack;
      const pack = isPack;

      // ตรวจสอบจำนวนสินค้าในสต็อก
      const requestedQuantity = pack ? quantity * product.packSize : quantity;
      if (requestedQuantity > product.quantity) {
        return res.status(400).json({ 
          message: `ไม่สามารถเพิ่มสินค้าได้ จำนวนสินค้าในสต็อกมีเพียง ${product.quantity} ${pack ? 'ชิ้น' : 'หน่วย'}`
        });
      }

      const price = pack ? product.sellingPricePerPack : product.sellingPricePerUnit;
  
      // ค้นหาสินค้าในตะกร้าของผู้ใช้
      const existingItem = await CartModel.findOne({ productId: product._id, userName });
  
      if (existingItem) {
        // ตรวจสอบจำนวนรวมที่จะมีในตะกร้า
        const newTotalQuantity = pack ? 
          (existingItem.quantity + quantity) * product.packSize : 
          existingItem.quantity + quantity;

        if (newTotalQuantity > product.quantity) {
          return res.status(400).json({ 
            message: `ไม่สามารถเพิ่มสินค้าได้ จำนวนสินค้าในสต็อกมีเพียง ${product.quantity} ${pack ? 'ชิ้น' : 'หน่วย'}`
          });
        }

        // ถ้าพบสินค้าในตะกร้าแล้ว เพิ่มจำนวนสินค้า
        existingItem.quantity += quantity;
        const updatedItem = await existingItem.save();
        return res.json(updatedItem);
      }
  
      // ถ้าไม่พบสินค้าในตะกร้า สร้างรายการใหม่
      const cart = new CartModel({
        productId: product._id,
        name: product.productName,
        price,
        image: product.productImage,
        quantity,
        userName,
        pack
      });
  
      const newItem = await cart.save();
      res.status(201).json(newItem);
    } catch (error) {
      console.error("Error during cart creation:", error);
      res.status(500).json({ message: error.message || "Something went wrong!" });
    }
  };
  