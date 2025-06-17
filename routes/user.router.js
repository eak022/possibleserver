const express = require("express");
const router = express.Router();
const {
  register,
  login,
  logout,
  updateProfile,
  checkAuth,
  updateProfileImage,
  updateUser,
  updatePassword
} = require("../controllers/user.controller");
const authenticateToken = require("../middlewares/authJwt.middleware");
const { uploadUserImage } = require("../middlewares/upload");

//http://localhost:5000/api/v1/auth/
router.post("/register", register);
router.post("/login", login);
router.post("/logout", logout);
router.put("/updateProfile", authenticateToken, updateProfile);
router.get("/check-auth", authenticateToken, checkAuth);
router.patch("/profile-image", authenticateToken, uploadUserImage.single("profileImage"), updateProfileImage);
router.put("/profile", authenticateToken, uploadUserImage.single("profileImage"), updateUser);
router.put("/password", authenticateToken, updatePassword);

module.exports = router;
