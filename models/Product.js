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
        default: [],
        validate: {
            validator: function(lots) {
                // ตรวจสอบความซ้ำซ้อนของเลขล็อต
                const lotNumbers = lots.map(lot => lot.lotNumber);
                const uniqueLotNumbers = new Set(lotNumbers);
                return lotNumbers.length === uniqueLotNumbers.size;
            },
            message: 'เลขล็อตไม่สามารถซ้ำกันได้'
        }
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
    
    // ✅ กรองเฉพาะล็อตที่มีวันหมดอายุ
    const lotsWithExpiration = activeLots.filter(lot => lot.expirationDate);
    if (lotsWithExpiration.length === 0) return null;
    
    return new Date(Math.min(...lotsWithExpiration.map(lot => lot.expirationDate)));
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
    
    // ✅ ตรวจสอบความซ้ำซ้อนของเลขล็อต
    const existingLotNumbers = this.lots.map(lot => lot.lotNumber);
    if (existingLotNumbers.includes(lotNumber)) {
        return Promise.reject(new Error(`เลขล็อต ${lotNumber} มีอยู่แล้วในสินค้านี้`));
    }
    
    // ✅ จัดการ expirationDate ให้ถูกต้อง
    let expirationDate = null;
    if (lotData.expirationDate) {
        // ตรวจสอบว่าวันที่ที่ส่งมาเป็นวันที่ที่ถูกต้องหรือไม่
        const date = new Date(lotData.expirationDate);
        if (!isNaN(date.getTime())) {
            expirationDate = date;
        }
    }
    
    this.lots.push({
        lotNumber,
        quantity: lotData.quantity,
        purchasePrice: lotData.purchasePrice,
        expirationDate: expirationDate, // จะเป็น null ถ้าไม่มีวันหมดอายุ
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

    // ✅ FIFO - ตัดจากล็อตที่หมดอายุเร็วสุดก่อน (ตามเงื่อนไขกรอง)
    // แต่ถ้าไม่มีวันหมดอายุ ให้ตัดจากล็อตที่ไม่มีวันหมดอายุก่อน
    const lotsArray = Array.isArray(this.lots) ? this.lots : [];
    const activeLots = lotsArray
        .filter(lot => lot.status === 'active' && lot.quantity > 0)
        .filter(lot => (includeSet ? includeSet.has(lot.lotNumber) : true))
        .filter(lot => (excludeSet ? !excludeSet.has(lot.lotNumber) : true))
        .sort((a, b) => {
            // ✅ หลักการตัดสต็อก: ล็อตที่มีวันหมดอายุก่อน (FEFO - First Expired, First Out)
            // 1. ถ้าทั้งคู่ไม่มีวันหมดอายุ → เรียงตามวันที่รับสินค้า (เก่าก่อน)
            if (!a.expirationDate && !b.expirationDate) {
                return new Date(a.receivedDate) - new Date(b.receivedDate);
            }
            // 2. ถ้า a ไม่มีวันหมดอายุ → มาหลัง (ไม่มีวันหมดอายุ = หมดอายุช้า)
            if (!a.expirationDate) return 1;
            // 3. ถ้า b ไม่มีวันหมดอายุ → มาก่อน (ไม่มีวันหมดอายุ = หมดอายุช้า)
            if (!b.expirationDate) return -1;
            // 4. ถ้ามีวันหมดอายุทั้งคู่ → เรียงตามวันหมดอายุ (หมดอายุเร็วสุดก่อน)
            return new Date(a.expirationDate) - new Date(b.expirationDate);
        });

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
    // ✅ สร้างเลขล็อตที่ไม่ซ้ำกัน
    const existingLots = this.lots.filter(lot => lot.status !== 'disposed');
    const existingLotNumbers = new Set(existingLots.map(lot => lot.lotNumber));
    
    let nextNumber = 1;
    let lotNumber;
    
    // หาเลขล็อตถัดไปที่ไม่ซ้ำกัน
    do {
        lotNumber = `LOT${nextNumber.toString().padStart(3, '0')}`;
        nextNumber++;
    } while (existingLotNumbers.has(lotNumber));
    
    return lotNumber;
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

// ✅ ฟังก์ชันใหม่: เปลี่ยนเลขล็อตพร้อมตรวจสอบความซ้ำซ้อน
ProductSchema.methods.changeLotNumber = function(oldLotNumber, newLotNumber) {
    const lot = this.lots.find(l => l.lotNumber === oldLotNumber);
    if (!lot) {
        return Promise.reject(new Error('Lot not found'));
    }
    
    // ตรวจสอบว่าเลขล็อตใหม่ซ้ำกับที่มีอยู่หรือไม่
    const existingLotNumbers = this.lots
        .filter(l => l.lotNumber !== oldLotNumber) // ไม่รวมล็อตปัจจุบัน
        .map(l => l.lotNumber);
    
    if (existingLotNumbers.includes(newLotNumber)) {
        return Promise.reject(new Error(`เลขล็อต ${newLotNumber} มีอยู่แล้วในสินค้านี้`));
    }
    
    lot.lotNumber = newLotNumber;
    lot.lastModified = new Date();
    return this.save();
};

const ProductModel = model("Product", ProductSchema);
module.exports = ProductModel;
  