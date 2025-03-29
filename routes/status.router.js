const express = require("express");
const router = express.Router();
const {createStatus, getAllStatuses , getStatusById, updateStatus, deleteStatus} = require("../controllers/status.controller");

router.post("/",createStatus);
router.get("/",getAllStatuses);
router.get("/:id",getStatusById);
router.put("/:id",updateStatus);
router.delete("/:id",deleteStatus);


module.exports = router;
