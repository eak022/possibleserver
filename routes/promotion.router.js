const express = require("express");
const router = express.Router();
const {createPromotion, getAllPromotions , getPromotionById, updatePromotion, deletePromotion} = require("../controllers/promotion.controller");

router.post("/",createPromotion);
router.get("/",getAllPromotions);
router.get("/:id",getPromotionById);
router.put("/:id",updatePromotion);
router.delete("/:id",deletePromotion);



module.exports = router;
