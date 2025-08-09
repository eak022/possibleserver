const express = require("express");
const router = express.Router();
const {
  createProduct,
  getAllProducts,
  getProductByBarcode,
  getProductById,
  updateProductImage,
  updateProductData,
  deleteProductById,
  // ✅ Lot management functions
  addLotToProduct,
  getProductLots,
  updateLotQuantity,
  disposeLot,
  checkStockAvailability,
  updateLotDetails,
  updateLotComplete,
  generateInternalBarcode
} = require("../controllers/product.controller");
const { upload } = require("../middlewares/upload");
const updateProductStatus = require("../middlewares/productStatusMiddleware");

// ใช้ middleware อัพเดทสถานะสินค้าก่อนเรียกใช้ controller
router.use(updateProductStatus);

// ✅ Product routes (เดิม)
router.post("/", upload.single("productImage"), createProduct);
router.get("/", getAllProducts);
router.get("/barcode/:barcode", getProductByBarcode);
router.get("/:id", getProductById);
router.patch("/:id/image", upload.single("productImage"), updateProductImage);
router.put("/:id", upload.single("productImage"), updateProductData);
router.delete("/:id", deleteProductById);

// ✅ Barcode generation (ภายในร้าน)
router.post("/generate-barcode", generateInternalBarcode);

// ✅ Lot management routes (ใหม่)
router.post("/:productId/lots", addLotToProduct);                    // เพิ่มล็อตใหม่
router.get("/:productId/lots", getProductLots);                      // ดูล็อตทั้งหมด
router.get("/:productId/stock-check", checkStockAvailability);       // ตรวจสอบสต็อก
router.put("/:productId/lots/:lotNumber", updateLotQuantity);        // แก้ไขจำนวนล็อต
router.patch("/:productId/lots/:lotNumber/dispose", disposeLot);     // ตัดจำหน่ายล็อต

// ✅ ฟังก์ชันใหม่: แก้ไขข้อมูลล็อต
router.patch("/:productId/lots/:lotNumber/details", updateLotDetails);     // แก้ไขราคาและวันหมดอายุ
router.put("/:productId/lots/:lotNumber/complete", updateLotComplete);     // แก้ไขข้อมูลล็อตทั้งหมด

module.exports = router;
