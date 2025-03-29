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
  const { productId, quantity, userName, pack } = req.body; // รับแค่ productId และข้อมูลที่จำเป็นเท่านั้น
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

    // กำหนดราคาตามว่า pack เป็น true หรือไม่
    const price = pack ? product.sellingPricePerPack : product.sellingPricePerUnit;

    // ค้นหาสินค้าในตะกร้าของผู้ใช้
    const existingItem = await CartModel.findOne({ productId, userName });

    if (existingItem) {
      // ถ้าพบสินค้าในตะกร้าแล้ว ให้เพิ่มจำนวนสินค้า
      existingItem.quantity += quantity;
      const updatedItem = await existingItem.save();
      return res.json(updatedItem);
    }

    // ถ้าไม่พบสินค้าในตะกร้า ให้สร้างรายการใหม่
    const cart = new CartModel({
      productId,
      name: product.productName,  // ใช้ชื่อสินค้า
      price,                      // ใช้ราคาที่คำนวณจาก pack
      image: product.productImage,  // ใช้รูปภาพสินค้า
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
    const carts = await CartModel.find({ userName: req.user.name });
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
    const { quantity, pack } = req.body;
  
    console.log("Received quantity:", quantity);
    console.log("Received pack:", pack);
  
    try {
      // ค้นหาสินค้าในตะกร้า
      const cartItem = await CartModel.findById(req.params.id);
  
      if (!cartItem) {
        return res.status(404).json({ message: "Item not found!" });
      }
  
      // ค้นหาสินค้าจาก productId เพื่อดึงราคามาใช้
      const product = await ProductModel.findById(cartItem.productId);
  
      if (!product) {
        return res.status(404).json({ message: "Product not found!" });
      }
  
      // กำหนดราคาตามว่า pack เป็น true หรือไม่
      let price = cartItem.price; // เก็บราคาปัจจุบันไว้ก่อน
      if (pack !== undefined) {
        price = pack ? product.sellingPricePerPack : product.sellingPricePerUnit;
      }
  
      // อัปเดตเฉพาะถ้ามีการเปลี่ยนแปลง
      if (quantity !== undefined && quantity !== null) {
        // ถ้า quantity ถูกส่งมา อัปเดต quantity
        cartItem.quantity = Number(quantity);
      }
  
      if (pack !== undefined) {
        // ถ้า pack ถูกส่งมา อัปเดตราคา
        cartItem.pack = pack;
      }
  
      // อัปเดตราคาใหม่ถ้าจำเป็น
      cartItem.price = price;
  
      // บันทึกการอัปเดต
      const updatedItem = await cartItem.save();
  
      res.json(updatedItem);
    } catch (error) {
      res.status(500).json({ message: error.message || "Failed to update cart item." });
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
    const { barcode, quantity, userName, pack } = req.body; // รับแค่ barcode, quantity, userName, และ pack
    console.log("Received data:", req.body);
  
    // ตรวจสอบข้อมูลที่ขาดหายไป
    if (!barcode || !quantity || !userName || pack === undefined) {
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

      const price = pack ? product.sellingPricePerPack : product.sellingPricePerUnit;
  
      // ค้นหาสินค้าในตะกร้าของผู้ใช้
      const existingItem = await CartModel.findOne({ productId: product._id, userName });
  
      if (existingItem) {
        // ถ้าพบสินค้าในตะกร้าแล้ว เพิ่มจำนวนสินค้า
        existingItem.quantity += quantity;
        const updatedItem = await existingItem.save();
        return res.json(updatedItem);
      }
  
      // ถ้าไม่พบสินค้าในตะกร้า สร้างรายการใหม่
      const cart = new CartModel({
        productId: product._id,
        name: product.productName,  // ใช้ชื่อสินค้า
        price,
        image: product.productImage,  // ใช้รูปภาพสินค้า
        quantity,
        userName,
        pack  // แพ็คหรือชิ้น
      });
  
      const newItem = await cart.save();
      res.status(201).json(newItem);
    } catch (error) {
      console.error("Error during cart creation:", error);
      res.status(500).json({ message: error.message || "Something went wrong!" });
    }
  };
  