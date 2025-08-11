const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const ProductSchema = new Schema({
    productName: { type: String, required: true },
    productDescription: { type: String },
    productImage: { type: String },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    packSize: { type: Number, required: true },
    productStatuses: [{ type: Schema.Types.ObjectId, ref: "Status" }],
    barcodePack: { type: String, unique: true, sparse: true },
    barcodeUnit: { type: String, unique: true, sparse: true },
    
    // ✅ ระบบล็อตใหม่ - เก็บข้อมูลแยกตามล็อต
    lots: {
        type: [{
            lotNumber: { type: String, required: true }, // เลขล็อต (auto-generated)
            quantity: { type: Number, required: true },   // จำนวนในล็อตนี้
            purchasePrice: { type: Number, required: true }, // ราคาซื้อล็อตนี้
            expirationDate: { type: Date, required: false },  // วันหมดอายุล็อตนี้ (ไม่บังคับ)
            receivedDate: { type: Date, default: Date.now },  // วันที่รับสินค้า
            purchaseOrderId: { type: Schema.Types.ObjectId, ref: "PurchaseOrder" }, // อ้างอิงใบสั่งซื้อ
            status: { type: String, enum: ["active", "expired", "disposed", "depleted"], default: "active" }
        }],
        default: []
    },
    // ข้อมูลราคาขาย (ใช้ร่วมกันทุกล็อต)
    sellingPricePerUnit: { type: Number, required: true },
    sellingPricePerPack: { type: Number, required: true },
    
}, { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// ✅ Virtual fields สำหรับคำนวณข้อมูลจาก lots
ProductSchema.virtual('totalQuantity').get(function() {
    const lots = Array.isArray(this.lots) ? this.lots : [];
    return lots
        .filter(lot => lot.status === 'active' && lot.quantity > 0)
        .reduce((total, lot) => total + lot.quantity, 0);
});

ProductSchema.virtual('nearestExpirationDate').get(function() {
    const lots = Array.isArray(this.lots) ? this.lots : [];
    const activeLots = lots.filter(lot => lot.status === 'active');
    if (activeLots.length === 0) return null;
    return new Date(Math.min(...activeLots.map(lot => lot.expirationDate)));
});

ProductSchema.virtual('averagePurchasePrice').get(function() {
    const lots = Array.isArray(this.lots) ? this.lots : [];
    const activeLots = lots.filter(lot => lot.status === 'active');
    if (activeLots.length === 0) return 0;
    const totalValue = activeLots.reduce((sum, lot) => sum + (lot.quantity * lot.purchasePrice), 0);
    const totalQuantity = activeLots.reduce((sum, lot) => sum + lot.quantity, 0);
    return totalQuantity > 0 ? totalValue / totalQuantity : 0;
});

// ✅ Instance methods สำหรับจัดการล็อต
ProductSchema.methods.addLot = function(lotData) {
    const lotNumber = lotData.lotNumber || this.generateLotNumber();
    this.lots.push({
        lotNumber,
        quantity: lotData.quantity,
        purchasePrice: lotData.purchasePrice,
        expirationDate: lotData.expirationDate,
        receivedDate: lotData.receivedDate || new Date(),
        purchaseOrderId: lotData.purchaseOrderId,
        status: 'active'
    });
    return this.save();
};

ProductSchema.methods.reduceLotQuantity = function(requiredQuantity, options = {}) {
    const { includeOnlyLotNumbers, excludeLotNumbers } = options;
    const includeSet = Array.isArray(includeOnlyLotNumbers) ? new Set(includeOnlyLotNumbers) : null;
    const excludeSet = Array.isArray(excludeLotNumbers) ? new Set(excludeLotNumbers) : null;

    // FIFO - ตัดจากล็อตที่หมดอายุเร็วสุดก่อน (ตามเงื่อนไขกรอง)
    const lotsArray = Array.isArray(this.lots) ? this.lots : [];
    const activeLots = lotsArray
        .filter(lot => lot.status === 'active' && lot.quantity > 0)
        .filter(lot => (includeSet ? includeSet.has(lot.lotNumber) : true))
        .filter(lot => (excludeSet ? !excludeSet.has(lot.lotNumber) : true))
        .sort((a, b) => new Date(a.expirationDate) - new Date(b.expirationDate));

    let remainingToReduce = requiredQuantity;
    const reductions = [];

    for (let lot of activeLots) {
        if (remainingToReduce <= 0) break;

        const quantityToTake = Math.min(lot.quantity, remainingToReduce);
        lot.quantity -= quantityToTake;
        remainingToReduce -= quantityToTake;

        reductions.push({
            lotNumber: lot.lotNumber,
            quantityTaken: quantityToTake,
            remainingInLot: lot.quantity
        });

        if (lot.quantity === 0) {
            lot.status = 'depleted';
        }
    }

    return {
        success: remainingToReduce === 0,
        reductions,
        remainingShortage: remainingToReduce
    };
};

ProductSchema.methods.generateLotNumber = function() {
    // ✅ ทำให้เลขล็อตง่ายขึ้น - ใช้แค่ตัวเลขเรียงลำดับ
    const existingLots = this.lots.filter(lot => lot.status !== 'disposed');
    const nextNumber = existingLots.length + 1;
    return `LOT${nextNumber.toString().padStart(3, '0')}`;
};

ProductSchema.methods.disposeLot = function(lotNumber, reason = 'manual') {
    const lot = this.lots.find(l => l.lotNumber === lotNumber);
    if (lot) {
        lot.status = 'disposed';
        lot.disposeReason = reason;
        lot.disposeDate = new Date();
        return this.save();
    }
    return Promise.reject(new Error('Lot not found'));
};

const ProductModel = model("Product", ProductSchema);
module.exports = ProductModel;
  