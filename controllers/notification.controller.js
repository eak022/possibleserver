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
                    notifications.lowStock.push({
                        productId: product._id,
                        productName: product.productName,
                        productImage: product.productImage,
                        quantity: product.quantity,
                        status: status.statusName,
                        statusColor: status.statusColor
                    });
                } else if (status.statusName === 'สินค้าใกล้หมดอายุ') {
                    notifications.expiring.push({
                        productId: product._id,
                        productName: product.productName,
                        productImage: product.productImage,
                        expirationDate: product.expirationDate,
                        status: status.statusName,
                        statusColor: status.statusColor
                    });
                } else if (status.statusName === 'หมดอายุ') {
                    notifications.expired.push({
                        productId: product._id,
                        productName: product.productName,
                        productImage: product.productImage,
                        expirationDate: product.expirationDate,
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

        const notifications = products.map(product => ({
            productId: product._id,
            productName: product.productName,
            productImage: product.productImage,
            quantity: product.quantity,
            status: 'สินค้าใกล้หมด',
            statusColor: lowStockStatus.statusColor
        }));

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
            expirationDate: product.expirationDate,
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