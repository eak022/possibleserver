const ProductModel = require('../models/Product');
const StatusModel = require('../models/Status');
const OrderModel = require('../models/Order');

const updateProductStatus = async (req, res, next) => {
    try {
        const products = await ProductModel.find().populate('productStatuses').populate('lots');
        const now = new Date();
        const sevenDaysFromNow = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));

        // ดึงสถานะทั้งหมด
        const [placedStatus, lowStockStatus, expiringStatus, outOfStockStatus, discontinuedStatus, expiredStatus] = await Promise.all([
            StatusModel.findOne({ statusName: 'วางจำหน่าย' }),
            StatusModel.findOne({ statusName: 'สินค้าใกล้หมด' }),
            StatusModel.findOne({ statusName: 'สินค้าใกล้หมดอายุ' }),
            StatusModel.findOne({ statusName: 'สินค้าหมด' }),
            StatusModel.findOne({ statusName: 'เลิกขาย' }),
            StatusModel.findOne({ statusName: 'หมดอายุ' })
        ]);

        for (const product of products) {
            let newStatuses = [];

            // ✅ อัปเดตสถานะของล็อตที่หมดอายุ
            let lotStatusUpdated = false;
            for (const lot of product.lots) {
                if (lot.status === 'active' && lot.expirationDate && new Date(lot.expirationDate) <= now) {
                    lot.status = 'expired';
                    lotStatusUpdated = true;
                    console.log(`Lot ${lot.lotNumber} expired and status updated to 'expired'`);
                }
            }
            
            // บันทึกการเปลี่ยนแปลงสถานะล็อต
            if (lotStatusUpdated) {
                await product.save();
            }

            // ตรวจสอบล็อตที่ใช้งานได้
            const activeLots = product.lots.filter(lot => lot.status === 'active' && lot.quantity > 0);

            // ตรวจสอบว่าสินค้าเป็นเลิกขายหรือไม่
            const isDiscontinued = product.productStatuses.some(status => 
                status.statusName === 'เลิกขาย'
            );

            if (isDiscontinued) {
                // ถ้าเป็นเลิกขาย ให้มีแค่สถานะเลิกขายอย่างเดียว
                newStatuses = [discontinuedStatus];
            } else {
                // เริ่มต้นด้วยสถานะวางจำหน่าย
                newStatuses = [placedStatus];

                // ✅ ตรวจสอบสินค้าหมดจากล็อตที่ใช้งานได้ (เฉพาะล็อตที่ยังไม่หมดอายุ)
                const sellableLots = product.lots.filter(lot => 
                    lot.status === 'active' && 
                    lot.quantity > 0 && 
                    (!lot.expirationDate || new Date(lot.expirationDate) > now)
                );
                
                if (sellableLots.length === 0) {
                    newStatuses = [outOfStockStatus];
                } else if (product.nearestExpirationDate && product.nearestExpirationDate <= now) {
                    newStatuses = [expiredStatus]; // ถ้าหมดอายุแล้ว ให้มีแค่สถานะหมดอายุอย่างเดียว (แต่สินค้าต้องไม่หมด)
                } else {
                    // ตรวจสอบสินค้าใกล้หมด (ใช้จำนวนจากล็อตที่ขายได้)
                    const sellableQuantity = sellableLots.reduce((total, lot) => total + lot.quantity, 0);
                    if (sellableQuantity < 5) {
                        newStatuses.push(lowStockStatus);
                    }

                    // ตรวจสอบสินค้าใกล้หมดอายุ (เฉพาะสินค้าที่ยังไม่หมดอายุ)
                    if (product.nearestExpirationDate && product.nearestExpirationDate <= sevenDaysFromNow) {
                        newStatuses.push(expiringStatus);
                    }
                }
            }

            // อัพเดทสถานะถ้ามีการเปลี่ยนแปลง
            const currentStatusIds = product.productStatuses.map(status => status._id.toString());
            const newStatusIds = newStatuses.map(status => status._id.toString());
            
            if (JSON.stringify(currentStatusIds.sort()) !== JSON.stringify(newStatusIds.sort())) {
                await ProductModel.findByIdAndUpdate(product._id, { 
                    productStatuses: newStatuses.map(status => status._id)
                });
            }
        }
        next();
    } catch (error) {
        console.error('Error updating product status:', error);
        next(error);
    }
};

// ✅ ฟังก์ชันสำหรับอัปเดตสถานะล็อตโดยตรง
const updateLotStatuses = async () => {
    try {
        const products = await ProductModel.find();
        const now = new Date();
        let updatedCount = 0;

        for (const product of products) {
            let lotStatusUpdated = false;
            for (const lot of product.lots) {
                if (lot.status === 'active' && lot.expirationDate && new Date(lot.expirationDate) <= now) {
                    lot.status = 'expired';
                    lotStatusUpdated = true;
                    console.log(`Lot ${lot.lotNumber} expired and status updated to 'expired'`);
                }
            }
            
            if (lotStatusUpdated) {
                await product.save();
                updatedCount++;
            }
        }

        console.log(`Updated lot statuses for ${updatedCount} products`);
        return { success: true, updatedProducts: updatedCount };
    } catch (error) {
        console.error('Error updating lot statuses:', error);
        return { success: false, error: error.message };
    }
};

module.exports = { updateProductStatus, updateLotStatuses }; 