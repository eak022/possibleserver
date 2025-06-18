const express = require("express");
const router = express.Router();
const {createPromotion, getAllPromotions, getPromotionById, updatePromotion, deletePromotion, getActivePromotions, getPromotionByProduct} = require("../controllers/promotion.controller");

router.post("/",createPromotion);
router.get("/",getAllPromotions);
router.get("/active",getActivePromotions);
router.get("/product/:productId",getPromotionByProduct);
router.get("/:id",getPromotionById);
router.put("/:id",updatePromotion);
router.delete("/:id",deletePromotion);

module.exports = router;
