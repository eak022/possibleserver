const ProductModel = require("../models/Product");
const cloudinary = require("../utils/cloudinary"); 

// 📌 CREATE: สร้างสินค้าใหม่ (แบบระบบล็อต)
exports.createProduct = async (req, res) => {
  try {
      const { 
          productName, 
          productDescription, 
          categoryId, 
          packSize, 
          productStatus, 
          barcodePack, 
          barcodeUnit, 
          sellingPricePerUnit, 
          sellingPricePerPack,
          // ✅ ข้อมูลล็อตแรก (optional - อาจจะไม่มีสต็อกตอนสร้าง)
          initialLot
      } = req.body;

      if (!req.file) {
          return res.status(400).json({ message: "Please upload a product image" });
      }

      // ตรวจสอบชื่อซ้ำ
      const nameExists = await ProductModel.findOne({ productName });
      if (nameExists) {
        return res.status(400).json({ message: "มีสินค้าชื่อนี้อยู่ในระบบแล้ว" });
      }
      
      // ตรวจสอบ barcodePack ซ้ำ
      if (barcodePack) {
        const barcodePackExists = await ProductModel.findOne({
          $or: [{ barcodePack }, { barcodeUnit: barcodePack }]
        });
        if (barcodePackExists) {
          return res.status(400).json({ message: "Barcode แพ็คนี้ถูกใช้ไปแล้ว" });
        }
      }
      
      // ตรวจสอบ barcodeUnit ซ้ำ
      if (barcodeUnit) {
        const barcodeUnitExists = await ProductModel.findOne({
          $or: [{ barcodePack: barcodeUnit }, { barcodeUnit: barcodeUnit }]
        });
        if (barcodeUnitExists) {
          return res.status(400).json({ message: "Barcode หน่วยนี้ถูกใช้ไปแล้ว" });
        }
      }

      const newProduct = new ProductModel({
          productName,
          productDescription,
          productImage: req.file.path,
          categoryId,
          packSize,
          productStatus,
          barcodePack,
          barcodeUnit,
          sellingPricePerUnit,
          sellingPricePerPack,
          lots: [] // เริ่มต้นเป็น array ว่าง
      });

      // ✅ ถ้ามีข้อมูลล็อตแรก ให้เพิ่มเข้าไป
      if (initialLot && initialLot.quantity > 0) {
          await newProduct.addLot({
              quantity: initialLot.quantity,
              purchasePrice: initialLot.purchasePrice,
              expirationDate: initialLot.expirationDate,
              lotNumber: initialLot.lotNumber
          });
      } else {
          await newProduct.save();
      }

      return res.status(201).json({ 
          message: "Product created successfully", 
          product: newProduct 
      });
  } catch (error) {
      if (error.code === 11000) {
        return res.status(400).json({ message: "ข้อมูลซ้ำในระบบ (ชื่อหรือบาร์โค้ด)" });
      }
      return res.status(500).json({ message: error.message });
  }
};

// 📌 READ: ดึงสินค้าทั้งหมด
exports.getAllProducts = async (req, res) => {
  try {
    const products = await ProductModel.find()
      .populate("categoryId", "categoryName")
      .populate("productStatuses", "statusName statusColor");
    res.json(products);
  } catch (error) {
    console.log(error.message);
    res.status(500).send({
      message: "Error occurred while fetching products.",
    });
  }
};

// 📌 READ: ดึงสินค้าโดย ID
exports.getProductById = async (req, res) => {
  const { id } = req.params;
  try {
    const product = await ProductModel.findById(id)
      .populate("categoryId", "categoryName")
      .populate("productStatuses", "statusName statusColor");

    if (!product) {
      return res.status(404).send({
        message: "Product not found.",
      });
    }

    res.json(product);
  } catch (error) {
    console.log(error.message);
    res.status(500).send({
      message: "Error occurred while fetching product by ID.",
    });
  }
};

// 📌 UPDATE: อัพเดทรูปภาพสินค้า
exports.updateProductImage = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await ProductModel.findById(id);

    if (!product) {
      return res.status(404).json({ message: "ไม่พบสินค้า" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "กรุณาอัพโหลดรูปภาพ" });
    }

    // ลบรูปเก่าจาก Cloudinary
    if (product.productImage) {
      const publicId = product.productImage.split('/').pop().split('.')[0];
      await cloudinary.uploader.destroy(`products/${publicId}`);
    }

    // อัพเดทรูปภาพใหม่
    const updatedProduct = await ProductModel.findByIdAndUpdate(
      id,
      { productImage: req.file.path },
      { new: true }
    ).populate("categoryId", "categoryName")
     .populate("productStatuses", "statusName statusColor");

    res.status(200).json({
      message: "อัพเดทรูปภาพสำเร็จ",
      product: updatedProduct
    });
  } catch (error) {
    console.error("Error updating product image:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัพเดทรูปภาพ" });
  }
};

// 📌 UPDATE: อัพเดทข้อมูลสินค้า
exports.updateProductData = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    // ตรวจสอบชื่อซ้ำ (ยกเว้นตัวเอง)
    if (updateData.productName) {
      const nameExists = await ProductModel.findOne({ productName: updateData.productName, _id: { $ne: id } });
      if (nameExists) {
        return res.status(400).json({ message: "มีสินค้าชื่อนี้อยู่ในระบบแล้ว" });
      }
    }
    // ตรวจสอบ barcodePack ซ้ำกับ barcodePack หรือ barcodeUnit ของสินค้าอื่น (ยกเว้นตัวเอง)
    if (updateData.barcodePack) {
      const barcodePackExists = await ProductModel.findOne({
        $or: [
          { barcodePack: updateData.barcodePack },
          { barcodeUnit: updateData.barcodePack }
        ],
        _id: { $ne: id }
      });
      if (barcodePackExists) {
        return res.status(400).json({ message: "Barcode แพ็คนี้ถูกใช้ไปแล้ว (อาจซ้ำกับ barcode แพ็คหรือ barcode หน่วยของสินค้าอื่น)" });
      }
    }
    // ตรวจสอบ barcodeUnit ซ้ำกับ barcodePack หรือ barcodeUnit ของสินค้าอื่น (ยกเว้นตัวเอง)
    if (updateData.barcodeUnit) {
      const barcodeUnitExists = await ProductModel.findOne({
        $or: [
          { barcodePack: updateData.barcodeUnit },
          { barcodeUnit: updateData.barcodeUnit }
        ],
        _id: { $ne: id }
      });
      if (barcodeUnitExists) {
        return res.status(400).json({ message: "Barcode หน่วยนี้ถูกใช้ไปแล้ว (อาจซ้ำกับ barcode แพ็คหรือ barcode หน่วยของสินค้าอื่น)" });
      }
    }

    // ถ้ามีการอัพโหลดรูปภาพใหม่
    if (req.file) {
      const product = await ProductModel.findById(id);
      if (!product) {
        return res.status(404).json({ message: "ไม่พบสินค้า" });
      }

      // ลบรูปเก่าจาก Cloudinary ถ้ามี
      if (product.productImage) {
        const publicId = product.productImage.split('/').pop().split('.')[0];
        await cloudinary.uploader.destroy(`products/${publicId}`);
      }

      updateData.productImage = req.file.path;
    }

    const updatedProduct = await ProductModel.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    ).populate("categoryId", "categoryName")
     .populate("productStatuses", "statusName statusColor");

    if (!updatedProduct) {
      return res.status(404).json({ message: "ไม่พบสินค้า" });
    }

    res.status(200).json({
      message: "อัพเดทข้อมูลสำเร็จ",
      product: updatedProduct
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: "ข้อมูลซ้ำในระบบ (ชื่อหรือบาร์โค้ด)" });
    }
    console.error("Error updating product:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัพเดทข้อมูล" });
  }
};

// 📌 DELETE: ลบสินค้า
exports.deleteProductById = async (req, res) => {
  const { id } = req.params;

  try {
    const product = await ProductModel.findById(id);
    if (!product) {
      return res.status(404).send({ message: "Product not found." });
    }

    // 📌 ดึง `public_id` ของรูปจาก URL Cloudinary เพื่อลบรูป
    const imageUrl = product.productImage;
    if (imageUrl) {
      const publicId = imageUrl.split("/").pop().split(".")[0]; // ดึง public_id ของ Cloudinary
      await cloudinary.uploader.destroy(`products/${publicId}`); // ลบจาก Cloudinary
    }

    // 📌 ลบสินค้าออกจากฐานข้อมูล
    await ProductModel.findByIdAndDelete(id);
    res.status(200).json({ message: "Product deleted successfully." });
  } catch (error) {
    console.log(error.message);
    res.status(500).send({ message: "Error occurred while deleting product." });
  }
};

// 📌 READ: ดึงสินค้าโดย barcodePack หรือ barcodeUnit
exports.getProductByBarcode = async (req, res) => {
  const { barcode } = req.params; // รับค่า barcode จาก URL

  try {
    // ค้นหาสินค้าโดย barcode (สามารถใช้ barcodePack หรือ barcodeUnit ได้)
    const product = await ProductModel.findOne({
      $or: [{ barcodePack: barcode }, { barcodeUnit: barcode }] // ค้นหาตาม barcodePack หรือ barcodeUnit
    })
      .populate("categoryId", "categoryName")
      .populate("productStatuses", "statusName statusColor");

    if (!product) {
      return res.status(404).send({
        message: "Product not found.",
      });
    }

    res.json(product);
  } catch (error) {
    console.log(error.message);
    res.status(500).send({
      message: "Error occurred while fetching product by barcode.",
    });
  }
};

// ✅ ระบบจัดการล็อตใหม่

// 📌 เพิ่มล็อตใหม่ให้กับสินค้า
exports.addLotToProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const { quantity, purchasePrice, expirationDate, lotNumber, purchaseOrderId } = req.body;

    const product = await ProductModel.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // ตรวจสอบ lotNumber ซ้ำในสินค้าเดียวกัน
    if (lotNumber && product.lots.some(lot => lot.lotNumber === lotNumber)) {
      return res.status(400).json({ message: "Lot number already exists for this product" });
    }

    await product.addLot({
      quantity,
      purchasePrice,
      expirationDate,
      lotNumber,
      purchaseOrderId
    });

    return res.status(201).json({ 
      message: "Lot added successfully", 
      product: product 
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// 📌 ดึงข้อมูลล็อตทั้งหมดของสินค้า
exports.getProductLots = async (req, res) => {
  try {
    const { productId } = req.params;
    const { status } = req.query; // filter by status (active, expired, disposed)

    const product = await ProductModel.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    let lots = product.lots;
    if (status) {
      lots = lots.filter(lot => lot.status === status);
    }

    return res.status(200).json({ 
      productName: product.productName,
      totalQuantity: product.totalQuantity,
      lots: lots 
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// 📌 ปรับปรุงจำนวนในล็อต
exports.updateLotQuantity = async (req, res) => {
  try {
    const { productId, lotNumber } = req.params;
    const { quantity, reason } = req.body;

    const product = await ProductModel.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const lot = product.lots.find(l => l.lotNumber === lotNumber);
    if (!lot) {
      return res.status(404).json({ message: "Lot not found" });
    }

    if (quantity < 0) {
      return res.status(400).json({ message: "Quantity cannot be negative" });
    }

    lot.quantity = quantity;
    lot.lastModified = new Date();
    if (reason) lot.modificationReason = reason;

    await product.save();

    return res.status(200).json({ 
      message: "Lot quantity updated successfully", 
      lot: lot 
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// 📌 ตัดจำหน่ายล็อต
exports.disposeLot = async (req, res) => {
  try {
    const { productId, lotNumber } = req.params;
    const { reason } = req.body;

    const product = await ProductModel.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    await product.disposeLot(lotNumber, reason);

    return res.status(200).json({ 
      message: "Lot disposed successfully" 
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// 📌 ตรวจสอบสต็อกพร้อมข้อมูลล็อต
exports.checkStockAvailability = async (req, res) => {
  try {
    const { productId } = req.params;
    const { requiredQuantity } = req.query;

    const product = await ProductModel.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const totalAvailable = product.totalQuantity;
    const isAvailable = totalAvailable >= parseInt(requiredQuantity);

    // แสดงล็อตที่มีสต็อก เรียงตามวันหมดอายุ
    const availableLots = product.lots
      .filter(lot => lot.status === 'active' && lot.quantity > 0)
      .sort((a, b) => new Date(a.expirationDate) - new Date(b.expirationDate));

    return res.status(200).json({
      productName: product.productName,
      totalAvailable,
      requiredQuantity: parseInt(requiredQuantity),
      isAvailable,
      availableLots,
      nearestExpiration: product.nearestExpirationDate
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ✅ ฟังก์ชันใหม่: แก้ไขราคาซื้อและวันหมดอายุในล็อต
exports.updateLotDetails = async (req, res) => {
  try {
    const { productId, lotNumber } = req.params;
    const { purchasePrice, expirationDate, reason } = req.body;

    const product = await ProductModel.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const lot = product.lots.find(l => l.lotNumber === lotNumber);
    if (!lot) {
      return res.status(404).json({ message: "Lot not found" });
    }

    // ตรวจสอบข้อมูลที่ส่งมา
    if (purchasePrice !== undefined) {
      if (purchasePrice < 0) {
        return res.status(400).json({ message: "Purchase price cannot be negative" });
      }
      lot.purchasePrice = purchasePrice;
    }

    if (expirationDate !== undefined) {
      const newExpirationDate = new Date(expirationDate);
      if (isNaN(newExpirationDate.getTime())) {
        return res.status(400).json({ message: "Invalid expiration date format" });
      }
      lot.expirationDate = newExpirationDate;
    }

    // บันทึกข้อมูลการแก้ไข
    lot.lastModified = new Date();
    if (reason) lot.modificationReason = reason;

    await product.save();

    return res.status(200).json({ 
      message: "Lot details updated successfully", 
      lot: lot,
      updatedProduct: product
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

// ✅ ฟังก์ชันใหม่: แก้ไขข้อมูลล็อตทั้งหมด (จำนวน, ราคา, วันหมดอายุ)
exports.updateLotComplete = async (req, res) => {
  try {
    const { productId, lotNumber } = req.params;
    const { quantity, purchasePrice, expirationDate, reason } = req.body;

    const product = await ProductModel.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const lot = product.lots.find(l => l.lotNumber === lotNumber);
    if (!lot) {
      return res.status(404).json({ message: "Lot not found" });
    }

    // ตรวจสอบและอัปเดตข้อมูล
    if (quantity !== undefined) {
      if (quantity < 0) {
        return res.status(400).json({ message: "Quantity cannot be negative" });
      }
      lot.quantity = quantity;
    }

    if (purchasePrice !== undefined) {
      if (purchasePrice < 0) {
        return res.status(400).json({ message: "Purchase price cannot be negative" });
      }
      lot.purchasePrice = purchasePrice;
    }

    if (expirationDate !== undefined) {
      const newExpirationDate = new Date(expirationDate);
      if (isNaN(newExpirationDate.getTime())) {
        return res.status(400).json({ message: "Invalid expiration date format" });
      }
      lot.expirationDate = newExpirationDate;
    }

    // บันทึกข้อมูลการแก้ไข
    lot.lastModified = new Date();
    if (reason) lot.modificationReason = reason;

    await product.save();

    return res.status(200).json({ 
      message: "Lot updated successfully", 
      lot: lot,
      updatedProduct: product
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
