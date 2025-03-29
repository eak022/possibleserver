const StatusModel = require("../models/Status");

exports.createStatus = async (req, res) => {
    const { statusName } = req.body;
  
    if (!statusName) {
      return res.status(400).json({ message: "Please provide the required field: statusName" });
    }
  
    try {
      // ไม่ต้องเช็ค statusId อีกต่อไป เพราะ MongoDB จะสร้าง _id ให้เอง
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
  
    try {
      const status = await StatusModel.findById(id);
      if (!status) {
        return res.status(404).json({ message: "Status not found" });
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
  
    try {
      const status = await StatusModel.findById(id);
      if (!status) {
        return res.status(404).json({ message: "Status not found" });
      }
  
      // ใช้ deleteOne แทน remove
      await StatusModel.deleteOne({ _id: id });
      return res.status(200).json({ message: "Status deleted successfully" });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Something went wrong while deleting status" });
    }
};
