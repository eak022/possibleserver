const express = require("express");
const router = express.Router();
const {createProduct, getAllProducts , getProductByBarcode,  getProductById, updateProductById, deleteProductById} = require("../controllers/product.controller");
const upload = require("../middlewares/upload")

router.post("/", upload.single("productImage"), createProduct); // เพิ่ม Middleware upload
router.get("/",getAllProducts);
router.get("/:id",getProductById);
router.get("/barcode/:barcode", getProductByBarcode); 
router.put("/:id", upload.single("productImage"), updateProductById);
router.delete("/:id",deleteProductById);


module.exports = router;
