const jwt = require("jsonwebtoken");
require("dotenv").config();

const authenticateToken = (req, res, next) => {
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

  try {
    const decoded = jwt.verify(token, process.env.SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ message: "Invalid or expired token" });
  }
};

module.exports = authenticateToken;
