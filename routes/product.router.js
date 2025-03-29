const express = require("express");
const router = express.Router();
const {createProduct, getAllProducts , getProductById, updateProductById, deleteProductById} = require("../controllers/product.controller");

router.post("/",createProduct);
router.get("/",getAllProducts);
router.get("/:id",getProductById);
router.put("/:id",updateProductById);
router.delete("/:id",deleteProductById);


module.exports = router;
