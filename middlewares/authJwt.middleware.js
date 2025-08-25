const TokenService = require("../services/token.service");

const authenticateToken = async (req, res, next) => {
  try {
    // รองรับได้ทั้ง HttpOnly cookie และ Authorization: Bearer <token>
    const cookieToken = req.cookies["x-access-token"];
    const authHeader = req.headers["authorization"] || "";
    const headerToken = authHeader.startsWith("Bearer ")
      ? authHeader.substring("Bearer ".length)
      : null;

    const token = cookieToken || headerToken;

    if (!token) {
      return res.status(401).json({ message: "Access token is missing" });
    }

    // ใช้ TokenService ตรวจสอบ token
    const decoded = await TokenService.verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.message === "Token has been revoked") {
      return res.status(401).json({ message: "Token has been revoked. Please login again." });
    } else if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token has expired. Please refresh your token." });
    } else if (error.name === "JsonWebTokenError") {
      return res.status(403).json({ message: "Invalid token" });
    } else {
      return res.status(403).json({ message: "Token verification failed" });
    }
  }
};

module.exports = authenticateToken;
