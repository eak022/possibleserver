const mongoose = require('mongoose');
const ProductModel = require('../models/Product');

// ✅ Migration Script: แปลงข้อมูลเก่าจาก quantity เป็น lots system
async function migrateToLotSystem() {
  try {
    console.log('🚀 Starting migration to lot system...');

    // หาสินค้าทั้งหมดที่ยังไม่มี lots หรือมี lots แต่ว่าง
    const products = await ProductModel.find({
      $or: [
        { lots: { $exists: false } },
        { lots: { $size: 0 } },
        { lots: null }
      ],
      quantity: { $gt: 0 } // เฉพาะสินค้าที่มี quantity > 0
    });

    console.log(`📦 Found ${products.length} products to migrate`);

    let migrated = 0;
    let errors = 0;

    for (const product of products) {
      try {
        // ตรวจสอบว่ามีข้อมูลที่จำเป็นหรือไม่
        if (!product.quantity || product.quantity <= 0) {
          console.log(`⏭️  Skipping ${product.productName}: No stock`);
          continue;
        }

        if (!product.purchasePrice || product.purchasePrice <= 0) {
          console.log(`⚠️  ${product.productName}: No purchase price, using default 0`);
        }

        if (!product.expirationDate) {
          console.log(`⚠️  ${product.productName}: No expiration date, using default (1 year from now)`);
        }

        // สร้างล็อตแรกจากข้อมูลเก่า
        const initialLot = {
          lotNumber: generateLotNumber(product.productName),
          quantity: product.quantity,
          purchasePrice: product.purchasePrice || 0,
          expirationDate: product.expirationDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
          receivedDate: product.createdAt || new Date(),
          status: 'active'
        };

        // เพิ่มล็อตให้กับสินค้า
        if (!product.lots) {
          product.lots = [];
        }
        product.lots.push(initialLot);

        // บันทึกการเปลี่ยนแปลง
        await product.save();

        console.log(`✅ Migrated ${product.productName}: ${product.quantity} units -> Lot ${initialLot.lotNumber}`);
        migrated++;

      } catch (error) {
        console.error(`❌ Error migrating ${product.productName}:`, error.message);
        errors++;
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`✅ Successfully migrated: ${migrated} products`);
    console.log(`❌ Errors: ${errors} products`);
    console.log(`📦 Total processed: ${products.length} products`);

    // สร้างรายงานผลการ migration
    const report = {
      timestamp: new Date(),
      totalProducts: products.length,
      migrated,
      errors,
      success: errors === 0
    };

    console.log('\n🎯 Migration completed!');
    return report;

  } catch (error) {
    console.error('💥 Migration failed:', error);
    throw error;
  }
}

// ✅ ฟังก์ชันลบข้อมูลเก่าหลังจาก migration เสร็จแล้ว
async function cleanupOldFields() {
  try {
    console.log('🧹 Starting cleanup of old fields...');

    // อัปเดต schema โดยลบ fields เก่าออก
    const result = await ProductModel.updateMany(
      {}, // ทุกเอกสาร
      {
        $unset: {
          quantity: "",
          purchasePrice: "",
          expirationDate: ""
        }
      }
    );

    console.log(`✅ Cleaned up old fields for ${result.modifiedCount} products`);
    return result;

  } catch (error) {
    console.error('💥 Cleanup failed:', error);
    throw error;
  }
}

// ฟังก์ชันสร้าง lot number
function generateLotNumber(productName) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const productCode = productName.slice(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X');
  return `MIG${productCode}${dateStr}${timeStr}`;
}

// ✅ Rollback function (ในกรณีที่ต้องกลับไปใช้ระบบเก่า)
async function rollbackFromLotSystem() {
  try {
    console.log('🔄 Starting rollback from lot system...');

    const products = await ProductModel.find({
      lots: { $exists: true, $ne: [] }
    });

    console.log(`📦 Found ${products.length} products to rollback`);

    let rolledBack = 0;

    for (const product of products) {
      try {
        // คำนวณ quantity รวมจาก lots ที่ active
        const totalQuantity = product.lots
          .filter(lot => lot.status === 'active')
          .reduce((sum, lot) => sum + lot.quantity, 0);

        // หาวันหมดอายุเร็วที่สุด
        const activeLots = product.lots.filter(lot => lot.status === 'active');
        const nearestExpiration = activeLots.length > 0 
          ? new Date(Math.min(...activeLots.map(lot => lot.expirationDate)))
          : null;

        // คำนวณราคาซื้อเฉลี่ย
        const avgPurchasePrice = activeLots.length > 0
          ? activeLots.reduce((sum, lot) => sum + (lot.quantity * lot.purchasePrice), 0) / totalQuantity
          : product.purchasePrice || 0;

        // อัปเดตข้อมูลเก่า
        product.quantity = totalQuantity;
        product.purchasePrice = avgPurchasePrice;
        if (nearestExpiration) {
          product.expirationDate = nearestExpiration;
        }

        // ลบ lots (หรือเก็บไว้ใน backup field)
        product.lotsBackup = product.lots; // backup
        product.lots = [];

        await product.save();

        console.log(`✅ Rolled back ${product.productName}: ${totalQuantity} units`);
        rolledBack++;

      } catch (error) {
        console.error(`❌ Error rolling back ${product.productName}:`, error.message);
      }
    }

    console.log(`\n✅ Rollback completed: ${rolledBack} products`);
    return { rolledBack, total: products.length };

  } catch (error) {
    console.error('💥 Rollback failed:', error);
    throw error;
  }
}

// ฟังก์ชันตรวจสอบข้อมูลหลัง migration
async function validateMigration() {
  try {
    console.log('🔍 Validating migration...');

    const products = await ProductModel.find();
    let valid = 0;
    let invalid = 0;

    for (const product of products) {
      const oldQuantity = product.quantity || 0;
      const newQuantity = product.totalQuantity || 0;

      if (oldQuantity === newQuantity) {
        valid++;
      } else {
        invalid++;
        console.log(`❌ Validation failed for ${product.productName}: Old=${oldQuantity}, New=${newQuantity}`);
      }
    }

    console.log(`\n✅ Validation results: ${valid} valid, ${invalid} invalid`);
    return { valid, invalid, total: products.length };

  } catch (error) {
    console.error('💥 Validation failed:', error);
    throw error;
  }
}

module.exports = {
  migrateToLotSystem,
  cleanupOldFields,
  rollbackFromLotSystem,
  validateMigration
};

// ถ้า run script โดยตรง
if (require.main === module) {
  const connectDB = async () => {
    try {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mern_possible');
      console.log('📊 Connected to MongoDB');
      
      // เรียกใช้ migration
      const result = await migrateToLotSystem();
      
      // ตรวจสอบผลลัพธ์
      await validateMigration();
      
      // ลบข้อมูลเก่าหลังจาก migration เสร็จแล้ว
      await cleanupOldFields();
      
      console.log('🎉 Migration process completed successfully!');
      process.exit(0);
    } catch (error) {
      console.error('💥 Migration process failed:', error);
      process.exit(1);
    }
  };

  connectDB();
}