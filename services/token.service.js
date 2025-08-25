const jwt = require("jsonwebtoken");
const BlacklistedTokenModel = require("../models/BlacklistedToken");
require("dotenv").config();

class TokenService {
  // สร้าง Access Token (อายุสั้น - 15 นาที)
  static generateAccessToken(userId, username) {
    return jwt.sign(
      { id: userId, username, type: 'access' },
      process.env.SECRET,
      { expiresIn: "15m" }
    );
  }

  // สร้าง Refresh Token (อายุยาว - 7 วัน)
  static generateRefreshToken(userId, username) {
    return jwt.sign(
      { id: userId, username, type: 'refresh' },
      process.env.REFRESH_SECRET || process.env.SECRET,
      { expiresIn: "7d" }
    );
  }

  // ตรวจสอบว่า Token อยู่ใน Blacklist หรือไม่
  static async isTokenBlacklisted(token) {
    try {
      const blacklistedToken = await BlacklistedTokenModel.findOne({ token });
      return !!blacklistedToken;
    } catch (error) {
      console.error("Error checking blacklisted token:", error);
      return true; // ถ้าเกิด error ให้ถือว่าเป็น blacklisted เพื่อความปลอดภัย
    }
  }

  // เพิ่ม Token เข้า Blacklist
  static async blacklistToken(token, userId) {
    try {
      const decoded = jwt.decode(token);
      const expiresAt = new Date(decoded.exp * 1000);
      
      await BlacklistedTokenModel.create({
        token,
        userId,
        expiresAt
      });
      
      return true;
    } catch (error) {
      console.error("Error blacklisting token:", error);
      return false;
    }
  }

  // ตรวจสอบ Access Token
  static async verifyAccessToken(token) {
    try {
      // ตรวจสอบว่า token อยู่ใน blacklist หรือไม่
      const isBlacklisted = await this.isTokenBlacklisted(token);
      if (isBlacklisted) {
        throw new Error("Token has been revoked");
      }

      // ตรวจสอบ JWT
      const decoded = jwt.verify(token, process.env.SECRET);
      
      // ตรวจสอบว่าเป็น access token หรือไม่
      if (decoded.type !== 'access') {
        throw new Error("Invalid token type");
      }

      return decoded;
    } catch (error) {
      throw error;
    }
  }

  // ตรวจสอบ Refresh Token
  static async verifyRefreshToken(token) {
    try {
      // ตรวจสอบว่า token อยู่ใน blacklist หรือไม่
      const isBlacklisted = await this.isTokenBlacklisted(token);
      if (isBlacklisted) {
        throw new Error("Token has been revoked");
      }

      // ตรวจสอบ JWT
      const decoded = jwt.verify(token, process.env.REFRESH_SECRET || process.env.SECRET);
      
      // ตรวจสอบว่าเป็น refresh token หรือไม่
      if (decoded.type !== 'refresh') {
        throw new Error("Invalid token type");
      }

      return decoded;
    } catch (error) {
      throw error;
    }
  }

  // ล้าง Blacklist tokens ที่หมดอายุแล้ว (ทำเป็น cron job)
  static async cleanupExpiredTokens() {
    try {
      const result = await BlacklistedTokenModel.deleteMany({
        expiresAt: { $lt: new Date() }
      });
      console.log(`Cleaned up ${result.deletedCount} expired tokens`);
    } catch (error) {
      console.error("Error cleaning up expired tokens:", error);
    }
  }
}

module.exports = TokenService;
