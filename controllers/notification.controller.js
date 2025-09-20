const ProductModel = require('../models/Product');
const StatusModel = require('../models/Status');

// ฟังก์ชันสำหรับดึงการแจ้งเตือนทั้งหมด
exports.getAllNotifications = async (req, res) => {
    try {
        // ดึงสถานะที่ต้องการแจ้งเตือน
        const [lowStockStatus, outOfStockStatus, expiringStatus, expiredStatus] = await Promise.all([
            StatusModel.findOne({ statusName: 'สินค้าใกล้หมด' }),
            StatusModel.findOne({ statusName: 'สินค้าหมด' }),
            StatusModel.findOne({ statusName: 'สินค้าใกล้หมดอายุ' }),
            StatusModel.findOne({ statusName: 'หมดอายุ' })
        ]);

        // ดึงสินค้าทั้งหมดที่มีสถานะที่ต้องการแจ้งเตือน
        const products = await ProductModel.find({
            $or: [
                { productStatuses: lowStockStatus._id },
                { productStatuses: outOfStockStatus._id },
                { productStatuses: expiringStatus._id },
                { productStatuses: expiredStatus._id }
            ]
        }).populate('productStatuses');

        // จัดกลุ่มการแจ้งเตือน
        const notifications = {
            lowStock: [],
            expiring: [],
            expired: []
        };

        products.forEach(product => {
            product.productStatuses.forEach(status => {
                if (status.statusName === 'สินค้าใกล้หมด' || status.statusName === 'สินค้าหมด') {
                    // คำนวณจำนวนที่ขายได้ (เฉพาะล็อตที่ยังไม่หมดอายุ)
                    const currentDate = new Date();
                    const sellableQuantity = product.lots.filter(lot => 
                        lot.status === 'active' && 
                        lot.quantity > 0 && 
                        (!lot.expirationDate || new Date(lot.expirationDate) > currentDate)
                    ).reduce((total, lot) => total + lot.quantity, 0);
                    
                    notifications.lowStock.push({
                        productId: product._id,
                        productName: product.productName,
                        productImage: product.productImage,
                        quantity: sellableQuantity,
                        lots: product.lots, // ส่งข้อมูล lots ไปด้วย
                        status: status.statusName,
                        statusColor: status.statusColor
                    });
                } else if (status.statusName === 'สินค้าใกล้หมดอายุ') {
                    notifications.expiring.push({
                        productId: product._id,
                        productName: product.productName,
                        productImage: product.productImage,
                        expirationDate: product.nearestExpirationDate,
                        lots: product.lots, // ส่งข้อมูล lots ไปด้วย
                        status: status.statusName,
                        statusColor: status.statusColor
                    });
                } else if (status.statusName === 'หมดอายุ') {
                    // คำนวณจำนวนล็อตที่หมดอายุและมีสต็อกอยู่
                    const currentDate = new Date();
                    const expiredLots = product.lots.filter(lot => {
                        // ตรวจสอบว่าล็อตมีวันหมดอายุและหมดอายุแล้ว
                        return lot.status === 'expired' || lot.status === 'active' && 
                               lot.quantity > 0 && 
                               lot.expirationDate && 
                               new Date(lot.expirationDate) <= currentDate;
                    });
                    const totalExpiredQuantity = expiredLots.reduce((sum, lot) => sum + lot.quantity, 0);
                    
                    // หาวันหมดอายุที่เก่าที่สุดจากล็อตที่หมดอายุ
                    const oldestExpiredDate = expiredLots.length > 0 
                        ? expiredLots.reduce((oldest, lot) => {
                            const lotExpirationDate = new Date(lot.expirationDate);
                            return lotExpirationDate < oldest ? lotExpirationDate : oldest;
                        }, new Date(expiredLots[0].expirationDate))
                        : null;

                    notifications.expired.push({
                        productId: product._id,
                        productName: product.productName,
                        productImage: product.productImage,
                        expirationDate: oldestExpiredDate, // วันที่หมดอายุจากล็อตที่หมดอายุจริง
                        quantity: totalExpiredQuantity, // จำนวนล็อตที่หมดอายุและมีสต็อก
                        lots: product.lots, // ส่งข้อมูล lots ไปด้วย
                        expiredLots: expiredLots, // ส่งข้อมูลล็อตที่หมดอายุไปด้วย
                        status: status.statusName,
                        statusColor: status.statusColor
                    });
                }
            });
        });

        // นับจำนวนการแจ้งเตือนแต่ละประเภท
        const notificationCounts = {
            total: notifications.lowStock.length + notifications.expiring.length + notifications.expired.length,
            lowStock: notifications.lowStock.length,
            expiring: notifications.expiring.length,
            expired: notifications.expired.length
        };

        res.json({
            success: true,
            notifications,
            counts: notificationCounts
        });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการดึงข้อมูลการแจ้งเตือน',
            error: error.message
        });
    }
};

// ฟังก์ชันสำหรับดึงการแจ้งเตือนสินค้าใกล้หมด
exports.getLowStockNotifications = async (req, res) => {
    try {
        const lowStockStatus = await StatusModel.findOne({ statusName: 'สินค้าใกล้หมด' });
        
        const products = await ProductModel.find({
            productStatuses: lowStockStatus._id
        }).populate('productStatuses');

        const notifications = products.map(product => {
            // คำนวณจำนวนที่ขายได้ (เฉพาะล็อตที่ยังไม่หมดอายุ)
            const currentDate = new Date();
            const sellableQuantity = product.lots.filter(lot => 
                lot.status === 'active' && 
                lot.quantity > 0 && 
                (!lot.expirationDate || new Date(lot.expirationDate) > currentDate)
            ).reduce((total, lot) => total + lot.quantity, 0);
            
            return {
                productId: product._id,
                productName: product.productName,
                productImage: product.productImage,
                quantity: sellableQuantity,
                lots: product.lots, // ส่งข้อมูล lots ไปด้วย
                status: 'สินค้าใกล้หมด',
                statusColor: lowStockStatus.statusColor
            };
        });

        res.json({
            success: true,
            notifications,
            count: notifications.length
        });
    } catch (error) {
        console.error('Error fetching low stock notifications:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการดึงข้อมูลการแจ้งเตือนสินค้าใกล้หมด',
            error: error.message
        });
    }
};

// ฟังก์ชันสำหรับดึงการแจ้งเตือนสินค้าใกล้หมดอายุ
exports.getExpiringNotifications = async (req, res) => {
    try {
        const expiringStatus = await StatusModel.findOne({ statusName: 'สินค้าใกล้หมดอายุ' });
        
        const products = await ProductModel.find({
            productStatuses: expiringStatus._id
        }).populate('productStatuses');

        const notifications = products.map(product => ({
            productId: product._id,
            productName: product.productName,
            productImage: product.productImage,
            expirationDate: product.nearestExpirationDate,
            status: 'สินค้าใกล้หมดอายุ',
            statusColor: expiringStatus.statusColor
        }));

        res.json({
            success: true,
            notifications,
            count: notifications.length
        });
    } catch (error) {
        console.error('Error fetching expiring notifications:', error);
        res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการดึงข้อมูลการแจ้งเตือนสินค้าใกล้หมดอายุ',
            error: error.message
        });
    }
}; 