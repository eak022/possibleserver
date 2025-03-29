const jwt = require("jsonwebtoken");
require("dotenv").config();

const authenticateToken = (req, res, next) => {
  const token = req.cookies["x-access-token"]; // ดึงโทเค็นจากคุกกี้

  if (!token) {
    return res.status(401).json({ message: "Access token is missing" });
  }

  try {
    const decoded = jwt.verify(token, process.env.SECRET); // ตรวจสอบและถอดรหัสโทเค็น
    req.user = decoded; // เก็บข้อมูลผู้ใช้ใน req.user
    next();
  } catch (error) {
    return res.status(403).json({ message: "Invalid or expired token" });
  }
};

module.exports = authenticateToken;
