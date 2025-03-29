const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const UserModel = require("../models/User");
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
      httpOnly: true, // ป้องกัน XSS (JavaScript ฝั่ง Client ไม่สามารถเข้าถึง)
      secure: process.env.NODE_ENV === "production", // ใช้ secure mode บน HTTPS
      sameSite: "Strict", // ป้องกัน CSRF
      maxAge: 24 * 60 * 60 * 1000, // 1 วัน
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
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
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
