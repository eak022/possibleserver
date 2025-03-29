const CategoryModel = require("../models/Category");

exports.createCategory = async (req, res) => {
    const { categoryName } = req.body;  // categoryId ไม่ต้องรับแล้ว เพราะ MongoDB จะสร้าง _id ให้อัตโนมัติ
  
    if (!categoryName) {
      return res.status(400).json({ message: "Please provide categoryName" });
    }
  
    try {
      const newCategory = await CategoryModel.create({ categoryName });
      return res.status(201).json({ message: "Category created successfully", category: newCategory });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Something went wrong while creating category" });
    }
};

exports.getAllCategories = async (req, res) => {
    try {
      const categories = await CategoryModel.find();
      return res.status(200).json({ categories });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Something went wrong while fetching categories" });
    }
};

exports.getCategoryById = async (req, res) => {
    const { id } = req.params;
  
    try {
      const category = await CategoryModel.findById(id);
      if (!category) {
        return res.status(404).json({ message: "Category not found" });
      }
      return res.status(200).json({ category });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Something went wrong while fetching category" });
    }
};

exports.updateCategory = async (req, res) => {
    const { id } = req.params;
    const { categoryName } = req.body;  // ไม่มี categoryId แล้ว
  
    try {
      const category = await CategoryModel.findById(id);
      if (!category) {
        return res.status(404).json({ message: "Category not found" });
      }
  
      if (categoryName) category.categoryName = categoryName;  // อัปเดตแค่ categoryName
  
      await category.save();
      return res.status(200).json({ message: "Category updated successfully", category });
    } catch (error) {
      return res.status(500).json({ message: error.message || "Something went wrong while updating category" });
    }
};

exports.deleteCategory = async (req, res) => {
  const { id } = req.params;

  try {
    const category = await CategoryModel.findById(id);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    // ใช้ deleteOne แทน remove
    await CategoryModel.deleteOne({ _id: id });
    return res.status(200).json({ message: "Category deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Something went wrong while deleting category" });
  }
};
