const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const ProductSchema = new Schema({
    productName: { type: String, required: true },
    productDescription: { type: String },
    productImage: { type: String },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    packSize: { type: Number, required: true },
    productStatuses: [{ type: Schema.Types.ObjectId, ref: "Status" }],
    barcodePack: { type: String, unique: true },
    barcodeUnit: { type: String, unique: true },
    
    // ✅ ระบบล็อตใหม่ - เก็บข้อมูลแยกตามล็อต
    lots: [{
        lotNumber: { type: String, required: true }, // เลขล็อต (auto-generated)
        quantity: { type: Number, required: true },   // จำนวนในล็อตนี้
        purchasePrice: { type: Number, required: true }, // ราคาซื้อล็อตนี้
        expirationDate: { type: Date, required: true },  // วันหมดอายุล็อตนี้
        receivedDate: { type: Date, default: Date.now },  // วันที่รับสินค้า
        purchaseOrderId: { type: Schema.Types.ObjectId, ref: "PurchaseOrder" }, // อ้างอิงใบสั่งซื้อ
        status: { type: String, enum: ["active", "expired", "disposed", "depleted"], default: "active" }
    }],
    
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
    return this.lots
        .filter(lot => lot.status === 'active' && lot.quantity > 0)
        .reduce((total, lot) => total + lot.quantity, 0);
});

ProductSchema.virtual('nearestExpirationDate').get(function() {
    const activeLots = this.lots.filter(lot => lot.status === 'active');
    if (activeLots.length === 0) return null;
    return new Date(Math.min(...activeLots.map(lot => lot.expirationDate)));
});

ProductSchema.virtual('averagePurchasePrice').get(function() {
    const activeLots = this.lots.filter(lot => lot.status === 'active');
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

ProductSchema.methods.reduceLotQuantity = function(requiredQuantity) {
    // FIFO - ตัดจากล็อตที่หมดอายุเร็วสุดก่อน
    const activeLots = this.lots
        .filter(lot => lot.status === 'active' && lot.quantity > 0)
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
        
        // ถ้าล็อตหมดแล้ว ไม่ต้องลบ เก็บไว้เป็น history
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
  