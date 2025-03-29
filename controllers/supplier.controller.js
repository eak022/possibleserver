const SupplierModel = require("../models/Supplier");

// Create Supplier
exports.createSupplier = async (req, res) => {
  const { companyName, sellerName, address, phoneNumber } = req.body;
  if (!companyName || !sellerName || !address || !phoneNumber) {
    return res.status(400).json({ message: "Please provide all required fields" });
  }

  try {
    const supplier = await SupplierModel.create({ companyName, sellerName, address, phoneNumber });
    return res.status(201).json({ message: "Supplier created successfully", supplier });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Something went wrong while creating supplier" });
  }
};

// Update Supplier Info
exports.updateSupplierInfo = async (req, res) => {
  const { id } = req.params; // รับ ID จาก URL
  const { companyName, sellerName, address, phoneNumber } = req.body;

  try {
    const supplier = await SupplierModel.findById(id);
    if (!supplier) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    // อัปเดตข้อมูล
    if (companyName) supplier.companyName = companyName;
    if (sellerName) supplier.sellerName = sellerName;
    if (address) supplier.address = address;
    if (phoneNumber) supplier.phoneNumber = phoneNumber;

    await supplier.save();
    return res.status(200).json({ message: "Supplier updated successfully", supplier });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Something went wrong while updating supplier" });
  }
};

// Delete Supplier
exports.deleteSupplier = async (req, res) => {
  const { id } = req.params;

  try {
    const supplier = await SupplierModel.findByIdAndDelete(id);
    if (!supplier) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    return res.status(200).json({ message: "Supplier deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Something went wrong while deleting supplier" });
  }
};

// Get All Suppliers
exports.getAllSupplier = async (req, res) => {
  try {
    const suppliers = await SupplierModel.find();
    return res.status(200).json(suppliers);
  } catch (error) {
    return res.status(500).json({ message: error.message || "Something went wrong while fetching suppliers" });
  }
};

// Get Supplier By ID
exports.getSupplierById = async (req, res) => {
  const { id } = req.params;

  try {
    const supplier = await SupplierModel.findById(id);
    if (!supplier) {
      return res.status(404).json({ message: "Supplier not found" });
    }

    return res.status(200).json(supplier);
  } catch (error) {
    return res.status(500).json({ message: error.message || "Something went wrong while fetching supplier" });
  }
};
