const PromotionModel = require("../models/Promotion");
const ProductModel = require("../models/Product");

// Helper: EAN-13 checksum
function calculateEan13CheckDigit(twelveDigits) {
  const digits = twelveDigits.split("").map(Number);
  const sum = digits.reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 1 : 3), 0);
  const mod = sum % 10;
  return mod === 0 ? 0 : 10 - mod;
}

// เจนบาร์โค้ดสำหรับโปรโมชัน (ช่วง 29 สำหรับ internal promotion)
async function generatePromotionBarcode() {
  const prefix = "29"; // ใช้ 29 เพื่อแยกจากสินค้า
  const typeDigit = "9"; // ระบุเป็น 'promotion'
  const now = new Date();
  const yy = now.getFullYear().toString().slice(-2);
  const mm = (now.getMonth() + 1).toString().padStart(2, "0");
  const yymm = `${yy}${mm}`;

  for (let running = 0; running <= 9999; running += 1) { // เผื่อรันถึง 4 หลักสำหรับโปร
    const seq = running.toString().padStart(4, "0");
    const twelve = `${prefix}${typeDigit}${yymm}${seq}`; // 2 + 1 + 4 + 4 = 11 → ต้องเพิ่มอีก 1 หลักคงที่
    // เติม digit คงที่อีก 1 หลักเพื่อให้ครบ 12 ก่อน checksum
    const twelveFull = `${twelve}0`;
    const check = calculateEan13CheckDigit(twelveFull);
    const code13 = `${twelveFull}${check}`;

    const exists = await PromotionModel.findOne({ barcode: code13 }).lean();
    if (!exists) return code13;
  }
  throw new Error("ไม่สามารถสร้างบาร์โค้ดโปรโมชันใหม่ได้");
}

exports.createPromotion = async (req, res) => {
  const { productId, promotionName, discountedPrice, validityStart, validityEnd, appliedLots } = req.body;

  if (!productId || !promotionName || !discountedPrice || !validityStart || !validityEnd) {
    return res.status(400).json({ message: "Please provide all required fields" });
  }

  try {
    // ตรวจสอบสินค้าและล็อตที่เลือกว่ามีอยู่จริงในสินค้านั้น
    const product = await ProductModel.findById(productId).lean();
    if (!product) return res.status(404).json({ message: "Product not found" });

    let lotsToApply = Array.isArray(appliedLots) ? appliedLots : (appliedLots ? [appliedLots] : []);
    if (lotsToApply.length > 0) {
      const now = new Date();
      const eligibleLots = (product.lots || []).filter(l => l.status === 'active' && l.quantity > 0 && (l.expirationDate ? new Date(l.expirationDate) > now : true));
      const eligibleLotNumbers = new Set(eligibleLots.map(l => l.lotNumber));
      const invalidLots = lotsToApply.filter(lotNo => !eligibleLotNumbers.has(lotNo));
      if (invalidLots.length > 0) {
        return res.status(400).json({ message: `ไม่สามารถใช้ล็อตเหล่านี้ได้ (อาจไม่พบ/หมดอายุ/ตัดจำหน่าย/สต็อกหมด): ${invalidLots.join(', ')}` });
      }
    }

    // บังคับให้ต้องเลือกอย่างน้อย 1 ล็อต
    if (lotsToApply.length === 0) {
      return res.status(400).json({ message: "กรุณาเลือกอย่างน้อย 1 ล็อตสำหรับโปรโมชันนี้" });
    }

    // ป้องกันชื่อโปรโมชันซ้ำภายใต้สินค้าเดียวกันและช่วงเวลาทับซ้อน
    const overlapQuery = {
      productId,
      promotionName,
      $or: [
        {
          validityStart: { $lte: new Date(validityEnd) },
          validityEnd: { $gte: new Date(validityStart) }
        }
      ]
    };
    const duplicateName = await PromotionModel.findOne(overlapQuery).lean();
    if (duplicateName) {
      return res.status(400).json({ message: "มีชื่อโปรโมชั่นนี้อยู่แล้วสำหรับสินค้านี้ในช่วงวันเวลาทับซ้อน" });
    }

    // ป้องกันโปรโมชันทับช่วงเวลาบนล็อตเดียวกัน
    const overlappingPromotions = await PromotionModel.find({
      productId,
      appliedLots: { $in: lotsToApply },
      validityStart: { $lte: new Date(validityEnd) },
      validityEnd: { $gte: new Date(validityStart) }
    }).lean();
    if (overlappingPromotions.length > 0) {
      // สรุปล็อตที่ชนกันเพื่อแจ้งข้อความ
      const overlapLots = new Set();
      overlappingPromotions.forEach(p => (p.appliedLots || []).forEach(l => { if (lotsToApply.includes(l)) overlapLots.add(l) }));
      const lotsStr = Array.from(overlapLots).join(', ');
      return res.status(400).json({ message: `มีโปรโมชันอื่นที่ทับช่วงเวลาบนล็อต: ${lotsStr}` });
    }

    // สร้างบาร์โค้ดสำหรับโปรโมชัน
    const promoBarcode = await generatePromotionBarcode();

    const newPromotion = await PromotionModel.create({
      productId,
      promotionName,
      discountedPrice,
      validityStart,
      validityEnd,
      appliedLots: lotsToApply,
      barcode: promoBarcode
    });

    return res.status(201).json({ message: "Promotion created successfully", promotion: newPromotion });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Duplicate promotion barcode" });
    }
    return res.status(500).json({ message: error.message || "Something went wrong while creating promotion" });
  }
};

exports.getAllPromotions = async (req, res) => {
  try {
    const promotions = await PromotionModel.find()
      .populate({ path: "productId", select: "productName sellingPricePerUnit" });
    return res.status(200).json({ promotions });
  } catch (error) {
    // Fallback: ส่งข้อมูลแบบไม่ populate เพื่อไม่ให้ 500
    console.error("getAllPromotions populate failed:", error?.message);
    try {
      const promotions = await PromotionModel.find().lean();
      return res.status(200).json({ promotions });
    } catch (innerErr) {
      return res.status(500).json({ message: innerErr.message || "Something went wrong while fetching promotions" });
    }
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
  const { productId, promotionName, discountedPrice, validityStart, validityEnd, appliedLots } = req.body;

  try {
    const promotion = await PromotionModel.findById(id);
    if (!promotion) {
      return res.status(404).json({ message: "Promotion not found" });
    }

    if (productId) {
      // ตรวจสอบสินค้าที่เปลี่ยนและล็อตใหม่
      const product = await ProductModel.findById(productId).lean();
      if (!product) return res.status(404).json({ message: "Product not found" });
      promotion.productId = productId;
      if (appliedLots) {
        const lotsToApply = Array.isArray(appliedLots) ? appliedLots : [appliedLots];
        const now = new Date();
        const eligibleLots = (product.lots || []).filter(l => l.status === 'active' && l.quantity > 0 && (l.expirationDate ? new Date(l.expirationDate) > now : true));
        const eligibleLotNumbers = new Set(eligibleLots.map(l => l.lotNumber));
        const invalidLots = lotsToApply.filter(lotNo => !eligibleLotNumbers.has(lotNo));
        if (invalidLots.length > 0) {
          return res.status(400).json({ message: `ไม่สามารถใช้ล็อตเหล่านี้ได้ (อาจไม่พบ/หมดอายุ/ตัดจำหน่าย/สต็อกหมด): ${invalidLots.join(', ')}` });
        }
        promotion.appliedLots = lotsToApply;
      }
    } else if (appliedLots) {
      // ถ้าไม่ได้เปลี่ยนสินค้า ให้ตรวจล็อตกับสินค้าปัจจุบัน
      const product = await ProductModel.findById(promotion.productId).lean();
      const lotsToApply = Array.isArray(appliedLots) ? appliedLots : [appliedLots];
      const now = new Date();
              const eligibleLots = (product.lots || []).filter(l => l.status === 'active' && l.quantity > 0 && (l.expirationDate ? new Date(l.expirationDate) > now : true));
      const eligibleLotNumbers = new Set(eligibleLots.map(l => l.lotNumber));
      const invalidLots = lotsToApply.filter(lotNo => !eligibleLotNumbers.has(lotNo));
      if (invalidLots.length > 0) {
        return res.status(400).json({ message: `ไม่สามารถใช้ล็อตเหล่านี้ได้ (อาจไม่พบ/หมดอายุ/ตัดจำหน่าย/สต็อกหมด): ${invalidLots.join(', ')}` });
      }
      promotion.appliedLots = lotsToApply;
    }

    // บังคับให้ต้องมีอย่างน้อย 1 ล็อตหลังอัปเดต
    if (!promotion.appliedLots || promotion.appliedLots.length === 0) {
      return res.status(400).json({ message: "กรุณาเลือกอย่างน้อย 1 ล็อตสำหรับโปรโมชันนี้" });
    }

    // ป้องกันชื่อโปรโมชันซ้ำภายใต้สินค้าเดียวกันและช่วงเวลาทับซ้อน (ยกเว้นตัวเอง)
    const finalProductId = promotion.productId;
    const finalName = promotionName || promotion.promotionName;
    const finalStart = validityStart ? new Date(validityStart) : promotion.validityStart;
    const finalEnd = validityEnd ? new Date(validityEnd) : promotion.validityEnd;
    if (finalProductId && finalName && finalStart && finalEnd) {
      const duplicateName = await PromotionModel.findOne({
        _id: { $ne: id },
        productId: finalProductId,
        promotionName: finalName,
        validityStart: { $lte: finalEnd },
        validityEnd: { $gte: finalStart }
      }).lean();
      if (duplicateName) {
        return res.status(400).json({ message: "มีชื่อโปรโมชั่นนี้อยู่แล้วสำหรับสินค้านี้ในช่วงวันเวลาทับซ้อน" });
      }
    }

    // ป้องกันโปรโมชันทับช่วงเวลาบนล็อตเดียวกัน (ยกเว้นตัวเอง)
    const finalLots = promotion.appliedLots || [];
    if (finalLots.length > 0) {
      const overlappingPromotions = await PromotionModel.find({
        _id: { $ne: id },
        productId: finalProductId,
        appliedLots: { $in: finalLots },
        validityStart: { $lte: finalEnd },
        validityEnd: { $gte: finalStart }
      }).lean();
      if (overlappingPromotions.length > 0) {
        const overlapLots = new Set();
        overlappingPromotions.forEach(p => (p.appliedLots || []).forEach(l => { if (finalLots.includes(l)) overlapLots.add(l) }));
        const lotsStr = Array.from(overlapLots).join(', ');
        return res.status(400).json({ message: `มีโปรโมชันอื่นที่ทับช่วงเวลาบนล็อต: ${lotsStr}` });
      }
    }

    if (promotionName) promotion.promotionName = promotionName;
    if (discountedPrice !== undefined) promotion.discountedPrice = discountedPrice;
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