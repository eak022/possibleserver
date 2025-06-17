const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "products", // ตั้งชื่อโฟลเดอร์ใน Cloudinary
    allowed_formats: ["jpg", "png", "jpeg"],
  },
});

const userStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "users", // ตั้งชื่อโฟลเดอร์สำหรับรูปโปรไฟล์
    allowed_formats: ["jpg", "png", "jpeg"],
  },
});

const upload = multer({ storage });
const uploadUserImage = multer({ storage: userStorage });

module.exports = { upload, uploadUserImage };
