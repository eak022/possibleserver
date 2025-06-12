const StatusModel = require('../models/Status');

const initializeStatuses = async () => {
    try {
        // ลบข้อมูลเก่าทั้งหมดก่อน
        await StatusModel.deleteMany({});

        const initialStatuses = [
            {
                statusName: 'วางจำหน่าย',
                statusColor: '#4CAF50'
            },
            {
                statusName: 'สินค้าใกล้หมด',
                statusColor: '#FFC107'
            },
            {
                statusName: 'สินค้าใกล้หมดอายุ',
                statusColor: '#FF9800'
            },
            {
                statusName: 'สินค้าหมด',
                statusColor: '#F44336'
            },
            {
                statusName: 'เลิกขาย',
                statusColor: '#9E9E9E'
            }
        ];

        // เพิ่มข้อมูลใหม่ทีละรายการ
        for (const status of initialStatuses) {
            await StatusModel.create(status);
        }
        
        console.log('Statuses initialized successfully');
    } catch (error) {
        console.error('Error initializing statuses:', error);
    }
};

const getStatusColor = (statusName) => {
    switch (statusName) {
        case 'สินค้าใหม่':
            return 'bg-blue-100 text-blue-800';
        case 'วางจำหน่าย':
            return 'bg-green-100 text-green-800';
        case 'สินค้าใกล้หมดอายุ':
            return 'bg-yellow-100 text-yellow-800';
        case 'สินค้าหมด':
            return 'bg-red-100 text-red-800';
        case 'เลิกขาย':
            return 'bg-gray-300 text-gray-700';
        default:
            return 'bg-gray-100 text-gray-800';
    }
};

module.exports = {
    initializeStatuses,
    getStatusColor
}; 