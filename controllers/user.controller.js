const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const UserModel = require("../models/User");
const cloudinary = require("../utils/cloudinary");
require("dotenv").config();
const secret = process.env.SECRET;

// Register
exports.register = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: "Please provide all required fields" });
  }

  try {
    // เช็คว่ามี username ซ้ำหรือไม่
    const existingUser = await UserModel.findOne({ username });
    if (existingUser) {
      return res.status(409).json({ message: "Username is already taken" });
    }

    const salt = await bcrypt.genSalt(10); // ใช้ async/await
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await UserModel.create({ username, password: hashedPassword });
    return res.status(201).json({ message: "User registered successfully", user });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Something went wrong" });
  }
};

// Login
exports.login = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: "Please provide your username and password." });
  }

  try {
    const userDoc = await UserModel.findOne({ username });
    if (!userDoc) {
      return res.status(404).json({ message: "User not found" });
    }

    const isPasswordMatched = await bcrypt.compare(password, userDoc.password);
    if (!isPasswordMatched) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: userDoc._id, username: userDoc.username },
      secret,
      { expiresIn: "24h" }
    );

    // ส่ง Token ผ่าน HttpOnly Cookie
    res.cookie("x-access-token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({ message: "User logged in successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Something went wrong while logging in" });
  }
};

// Logout
exports.logout = (req, res) => {
  res.clearCookie("x-access-token", {
    httpOnly: true,
    secure: true,
    sameSite: "none",
  });
  return res.status(200).json({ message: "User logged out successfully" });
};

// Update Profile
exports.updateProfile = async (req, res) => {
  const { phoneNumber, address, shopName } = req.body;
  const userId = req.user.id; // ดึง userId จาก Middleware

  try {
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (phoneNumber) user.phoneNumber = phoneNumber;
    if (address) user.address = address;
    if (shopName) user.shopName = shopName;

    await user.save();
    return res.status(200).json({ message: "Profile updated successfully", user });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Something went wrong while updating profile" });
  }
};

// ตรวจสอบสถานะการเข้าสู่ระบบ
exports.checkAuth = async (req, res) => {
  try {
    // req.user จะถูกเพิ่มโดย middleware authenticateToken
    const user = await UserModel.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    return res.status(200).json({ user });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Something went wrong while checking auth" });
  }
};

exports.updateProfileImage = async (req, res) => {
  try {
    // ดึง userId จาก token ที่ล็อกอินอยู่
    const userId = req.user.id;
    const user = await UserModel.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "ไม่พบผู้ใช้" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "กรุณาอัพโหลดรูปภาพ" });
    }

    // ถ้ามีรูปเก่า ให้ลบออกจาก Cloudinary
    if (user.profileImage) {
      const publicId = user.profileImage.split('/').pop().split('.')[0];
      await cloudinary.uploader.destroy(`users/${publicId}`);
    }

    // อัพเดทรูปโปรไฟล์
    const updatedUser = await UserModel.findByIdAndUpdate(
      userId,
      { profileImage: req.file.path },
      { new: true }
    );

    res.status(200).json({
      message: "อัพเดทรูปโปรไฟล์สำเร็จ",
      user: updatedUser
    });
  } catch (error) {
    console.error("Error updating profile image:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัพเดทรูปโปรไฟล์" });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const userId = req.user.id;
    const updateData = { ...req.body };

    // ลบ password ออกจาก updateData ถ้ามี
    delete updateData.password;

    // ตรวจสอบว่ามีข้อมูลที่จะอัพเดทหรือไม่
    if (Object.keys(updateData).length === 0 && !req.file) {
      return res.status(400).json({ message: 'กรุณาระบุข้อมูลที่ต้องการอัพเดท' });
    }

    // ถ้ามีการอัพโหลดรูปภาพใหม่
    if (req.file) {
      try {
        // อัพโหลดรูปใหม่ไปยัง Cloudinary
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: "users",
          width: 300,
          crop: "scale"
        });

        // ค้นหาผู้ใช้เพื่อลบรูปเก่า
        const user = await UserModel.findById(userId);
        if (user && user.profileImage) {
          // ดึง public_id จาก URL ของรูปเก่า
          const publicId = user.profileImage.split('/').pop().split('.')[0];
          // ลบรูปเก่าจาก Cloudinary
          await cloudinary.uploader.destroy(`users/${publicId}`);
        }

        // อัพเดท URL ของรูปใหม่
        updateData.profileImage = result.secure_url;
      } catch (error) {
        console.error('Error uploading image:', error);
        return res.status(500).json({ message: 'เกิดข้อผิดพลาดในการอัพโหลดรูปภาพ' });
      }
    }

    // อัพเดทข้อมูลผู้ใช้
    const updatedUser = await UserModel.findByIdAndUpdate(
      userId,
      updateData,
      { new: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ message: 'ไม่พบผู้ใช้' });
    }

    res.json({
      success: true,
      message: 'อัพเดทข้อมูลผู้ใช้สำเร็จ',
      user: updatedUser
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการอัพเดทข้อมูลผู้ใช้' });
  }
};

exports.updatePassword = async (req, res) => {
  try {
    const userId = req.user.id; // ดึง userId จาก token ที่ล็อกอินอยู่
    const { currentPassword, newPassword } = req.body;

    // ตรวจสอบว่ามีการส่งรหัสผ่านมาครบหรือไม่
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'กรุณาระบุรหัสผ่านปัจจุบันและรหัสผ่านใหม่' });
    }

    // ค้นหาผู้ใช้
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'ไม่พบผู้ใช้' });
    }

    // ตรวจสอบรหัสผ่านปัจจุบัน
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
    }

    // เข้ารหัสรหัสผ่านใหม่
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // อัพเดทรหัสผ่าน
    user.password = hashedPassword;
    await user.save();

    res.json({
      success: true,
      message: 'อัพเดทรหัสผ่านสำเร็จ'
    });
  } catch (error) {
    console.error('Error updating password:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการอัพเดทรหัสผ่าน' });
  }
};