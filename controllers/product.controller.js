const ProductModel = require("../models/Product");

// 📌 CREATE: สร้างสินค้าใหม่
exports.createProduct = async (req, res) => {
  const {
    productName,
    productDescription,
    productImage,
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
    const newProduct = new ProductModel({
      productName,
      productDescription,
      productImage,
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

    const savedProduct = await newProduct.save();
    res.status(201).json(savedProduct);
  } catch (error) {
    console.log(error.message);
    res.status(500).send({
      message: "Error occurred while creating product.",
    });
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

// 📌 UPDATE: อัปเดตข้อมูลสินค้าตาม ID
exports.updateProductById = async (req, res) => {
  const { id } = req.params;
  const {
    productName,
    productDescription,
    productImage,
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
    const updatedProduct = await ProductModel.findByIdAndUpdate(
      id,
      {
        productName,
        productDescription,
        productImage,
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
      { new: true } // ส่งค่าผลลัพธ์เป็นข้อมูลที่อัปเดตแล้ว
    );

    if (!updatedProduct) {
      return res.status(404).send({
        message: "Product not found.",
      });
    }

    res.json(updatedProduct);
  } catch (error) {
    console.log(error.message);
    res.status(500).send({
      message: "Error occurred while updating product.",
    });
  }
};

// 📌 DELETE: ลบสินค้าตาม ID
exports.deleteProductById = async (req, res) => {
  const { id } = req.params;

  try {
    const deletedProduct = await ProductModel.findByIdAndDelete(id);

    if (!deletedProduct) {
      return res.status(404).send({
        message: "Product not found.",
      });
    }

    res.status(200).json({
      message: "Product deleted successfully.",
    });
  } catch (error) {
    console.log(error.message);
    res.status(500).send({
      message: "Error occurred while deleting product.",
    });
  }
};

