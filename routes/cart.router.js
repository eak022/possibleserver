const express = require("express");
const router = express.Router();
const {getAllCarts, createCart , getCartsByUserName, deleteAllCarts, updateCartById, deleteCartById} = require("../controllers/cart.controller");

router.post("/",createCart);
router.get("/",getAllCarts);
router.get("/:userName",getCartsByUserName);
router.put("/:id",updateCartById);
router.delete("/deleteAllCarts/:userName",deleteAllCarts);
router.delete("/:id",deleteCartById);


module.exports = router;
