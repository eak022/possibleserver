const ProductModel = require('../models/Product');
const StatusModel = require('../models/Status');
const OrderModel = require('../models/Order');

const updateProductStatus = async (req, res, next) => {
    try {
        const products = await ProductModel.find().populate('productStatuses');
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

                // ตรวจสอบสินค้าหมด (priority สูงสุด)
                if (product.quantity <= 0) {
                    newStatuses = [outOfStockStatus];
                } else if (product.expirationDate && product.expirationDate <= now) {
                    newStatuses = [expiredStatus]; // ถ้าหมดอายุแล้ว ให้มีแค่สถานะหมดอายุอย่างเดียว (แต่สินค้าต้องไม่หมด)
                } else {
                    // ตรวจสอบสินค้าใกล้หมด
                    if (product.quantity < 5) {
                        newStatuses.push(lowStockStatus);
                    }

                    // ตรวจสอบสินค้าใกล้หมดอายุ (เฉพาะสินค้าที่ยังไม่หมดอายุ)
                    if (product.expirationDate && product.expirationDate <= sevenDaysFromNow) {
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

module.exports = updateProductStatus; 