const PromotionModel = require("../models/Promotion");

exports.createPromotion = async (req, res) => {
    const { productId, promotionName, discountedPrice, validityStart, validityEnd } = req.body;
  
    if (!productId || !promotionName || !discountedPrice || !validityStart || !validityEnd) {
      return res.status(400).json({ message: "Please provide all required fields" });
    }
  
    try {
      const newPromotion = await PromotionModel.create({
        productId,  // ใช้ _id ของ Product ใน MongoDB
        promotionName,
        discountedPrice,
        validityStart,
        validityEnd
      });
  
      return res.status(201).json({ message: "Promotion created successfully", promotion: newPromotion });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Something went wrong while creating promotion" });
    }
};

exports.getAllPromotions = async (req, res) => {
  try {
    //เพิ่มsellingPricePerUnitลงในpopulate
    const promotions = await PromotionModel.find().populate("productId", "productName sellingPricePerUnit");  // populate ด้วย _id ของ Product
    return res.status(200).json({ promotions });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Something went wrong while fetching promotions" });
  }
};

exports.getPromotionById = async (req, res) => {
    const { id } = req.params;
  
    try {
      const promotion = await PromotionModel.findById(id).populate("productId", "productName");  // populate ด้วย _id ของ Product
      if (!promotion) {
        return res.status(404).json({ message: "Promotion not found" });
      }
      return res.status(200).json({ promotion });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Something went wrong while fetching promotion" });
    }
};

exports.updatePromotion = async (req, res) => {
    const { id } = req.params;
    const { productId, promotionName, discountedPrice, validityStart, validityEnd } = req.body;
  
    try {
      const promotion = await PromotionModel.findById(id);
      if (!promotion) {
        return res.status(404).json({ message: "Promotion not found" });
      }
  
      if (productId) promotion.productId = productId;  // อัปเดต productId ด้วย _id ของ Product
      if (promotionName) promotion.promotionName = promotionName;
      if (discountedPrice) promotion.discountedPrice = discountedPrice;
      if (validityStart) promotion.validityStart = validityStart;
      if (validityEnd) promotion.validityEnd = validityEnd;
  
      await promotion.save();
      return res.status(200).json({ message: "Promotion updated successfully", promotion });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Something went wrong while updating promotion" });
    }
};

exports.deletePromotion = async (req, res) => {
  const { id } = req.params;

  try {
    const promotion = await PromotionModel.findById(id);
    if (!promotion) {
      return res.status(404).json({ message: "Promotion not found" });
    }

    // ใช้ deleteOne แทน remove
    await promotion.deleteOne();
    return res.status(200).json({ message: "Promotion deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Something went wrong while deleting promotion" });
  }
};

exports.getActivePromotions = async (req, res) => {
  try {
    const currentDate = new Date();
    const promotions = await PromotionModel.find({
      validityStart: { $lte: currentDate },
      validityEnd: { $gte: currentDate }
    }).populate("productId", "productName productImage sellingPricePerUnit sellingPricePerPack");
    
    return res.status(200).json({ promotions });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Something went wrong while fetching active promotions" });
  }
};

exports.getPromotionByProduct = async (req, res) => {
  const { productId } = req.params;
  
  try {
    const currentDate = new Date();
    const promotion = await PromotionModel.findOne({
      productId: productId,
      validityStart: { $lte: currentDate },
      validityEnd: { $gte: currentDate }
    }).populate("productId", "productName productImage sellingPricePerUnit sellingPricePerPack");
    
    if (!promotion) {
      return res.status(200).json({ promotion: null });
    }
    
    return res.status(200).json({ promotion });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Something went wrong while fetching promotion" });
  }
};