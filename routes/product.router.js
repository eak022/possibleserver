const express = require("express");
const router = express.Router();
const {
  createProduct,
  getAllProducts,
  getProductByBarcode,
  getProductById,
  updateProductImage,
  updateProductData,
  deleteProductById
} = require("../controllers/product.controller");
const { upload } = require("../middlewares/upload");
const updateProductStatus = require("../middlewares/productStatusMiddleware");

// ใช้ middleware อัพเดทสถานะสินค้าก่อนเรียกใช้ controller
router.use(updateProductStatus);

router.post("/", upload.single("productImage"), createProduct);
router.get("/", getAllProducts);
router.get("/barcode/:barcode", getProductByBarcode);
router.get("/:id", getProductById);
router.patch("/:id/image", upload.single("productImage"), updateProductImage);
router.put("/:id", upload.single("productImage"), updateProductData);
router.delete("/:id", deleteProductById);

module.exports = router;
