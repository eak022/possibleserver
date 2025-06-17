const ProductModel = require("../models/Product");
const cloudinary = require("../utils/cloudinary"); 

// 📌 CREATE: สร้างสินค้าใหม่
exports.createProduct = async (req, res) => {
  try {
      const { productName, productDescription, categoryId, packSize, productStatus, barcodePack, barcodeUnit, quantity, purchasePrice, sellingPricePerUnit, sellingPricePerPack, expirationDate } = req.body;

      if (!req.file) {
          return res.status(400).json({ message: "Please upload a product image" });
      }

      const newProduct = new ProductModel({
          productName,
          productDescription,
          productImage: req.file.path,  // ใช้ URL จาก Cloudinary
          categoryId,
          packSize,
          productStatus,
          barcodePack,
          barcodeUnit,
          quantity,
          purchasePrice,
          sellingPricePerUnit,
          sellingPricePerPack,
          expirationDate
      });

      await newProduct.save();
      return res.status(201).json({ message: "Product created successfully", product: newProduct });
  } catch (error) {
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
