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
      .populate("productStatus", "statusName");
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
      .populate("productStatus", "statusName");

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

exports.updateProductById = async (req, res) => {
  const { id } = req.params;
  const {
    productName,
    productDescription,
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
  } = req.body;

  try {
    let product = await ProductModel.findById(id);
    if (!product) {
      return res.status(404).send({ message: "Product not found." });
    }

    let imageUrl = product.productImage; // ค่าดั้งเดิมของรูปภาพ

    // 📌 เช็คว่ามีไฟล์ใหม่ถูกอัปโหลดหรือไม่
    if (req.file) {
      // ✅ อัปโหลดรูปไปที่ Cloudinary
      const uploadResponse = await cloudinary.uploader.upload(req.file.path, {
        folder: "products",
      });
      imageUrl = uploadResponse.secure_url; // URL ของรูปที่อัปโหลดใหม่
    }

    // 📌 อัปเดตข้อมูลสินค้า
    const updatedProduct = await ProductModel.findByIdAndUpdate(
      id,
      {
        productName,
        productDescription,
        productImage: imageUrl, // ✅ ใช้ URL ของ Cloudinary
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
      },
      { new: true }
    );

    res.json(updatedProduct);
  } catch (error) {
    console.log(error.message);
    res.status(500).send({ message: "Error occurred while updating product." });
  }
};

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
      .populate("productStatus", "statusName");

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
