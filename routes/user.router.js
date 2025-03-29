const express = require("express");
const router = express.Router();
const {register, login , logout, updateProfile} = require("../controllers/user.controller");
const authenticateToken = require("../middlewares/authJwt.middleware");

//http://localhost:5000/api/v1/auth/
router.post("/register",register);
router.post("/login",login);
router.post("/logout",logout);
router.put("/updateProfile",authenticateToken,updateProfile);


module.exports = router;
