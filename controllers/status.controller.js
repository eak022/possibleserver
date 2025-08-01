const StatusModel = require("../models/Status");

exports.createStatus = async (req, res) => {
    const { statusName } = req.body;
  
    if (!statusName) {
      return res.status(400).json({ message: "Please provide the required field: statusName" });
    }
  
    try {
      const existingStatus = await StatusModel.findOne({ statusName });
      if (existingStatus) {
        return res.status(400).json({ message: "A status with this name already exists." });
      }

      const newStatus = await StatusModel.create({ statusName });
      return res.status(201).json({ message: "Status created successfully", status: newStatus });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Something went wrong while creating status" });
    }
  };
  
exports.getAllStatuses = async (req, res) => {
    try {
      const statuses = await StatusModel.find();
      return res.status(200).json({ statuses });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Something went wrong while fetching statuses" });
    }
  };
  
exports.getStatusById = async (req, res) => {
    const { id } = req.params;
  
    try {
      const status = await StatusModel.findById(id);
      if (!status) {
        return res.status(404).json({ message: "Status not found" });
      }
      return res.status(200).json({ status });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Something went wrong while fetching status" });
    }
  };
  
exports.updateStatus = async (req, res) => {
    const { id } = req.params;
    const { statusName } = req.body;

    // รายชื่อสถานะหลักที่ห้ามแก้ไข
    const mainStatuses = [
        'วางจำหน่าย',
        'สินค้าใกล้หมด',
        'สินค้าใกล้หมดอายุ',
        'สินค้าหมด',
        'เลิกขาย',
        'หมดอายุ'
    ];
  
    try {
      const status = await StatusModel.findById(id);
      if (!status) {
        return res.status(404).json({ message: "Status not found" });
      }

      // เช็คถ้าเป็นสถานะหลัก
      if (mainStatuses.includes(status.statusName)) {
        return res.status(400).json({ message: "สถานะหลักไม่สามารถแก้ไขได้" });
      }

      if (statusName) {
        const existingStatus = await StatusModel.findOne({ statusName: statusName });
        if (existingStatus && existingStatus._id.toString() !== id) {
          return res.status(400).json({ message: "A status with this name already exists." });
        }
      }
  
      if (statusName) status.statusName = statusName;
  
      await status.save();
      return res.status(200).json({ message: "Status updated successfully", status });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Something went wrong while updating status" });
    }
  };
  
exports.deleteStatus = async (req, res) => {
    const { id } = req.params;

    // รายชื่อสถานะหลักที่ห้ามลบ
    const mainStatuses = [
        'วางจำหน่าย',
        'สินค้าใกล้หมด',
        'สินค้าใกล้หมดอายุ',
        'สินค้าหมด',
        'เลิกขาย',
        'หมดอายุ'
    ];

    try {
      const status = await StatusModel.findById(id);
      if (!status) {
        return res.status(404).json({ message: "Status not found" });
      }

      // เช็คถ้าเป็นสถานะหลัก
      if (mainStatuses.includes(status.statusName)) {
        return res.status(400).json({ message: "สถานะหลักไม่สามารถลบได้" });
      }

      // ใช้ deleteOne แทน remove
      await StatusModel.deleteOne({ _id: id });
      return res.status(200).json({ message: "Status deleted successfully" });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Something went wrong while deleting status" });
    }
};
