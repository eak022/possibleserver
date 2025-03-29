const express = require("express");
const router = express.Router();
const {
    createSupplier,
    updateSupplierInfo,
    deleteSupplier,
    getAllSupplier,
    getSupplierById,
  } = require("../controllers/supplier.controller");

//http://localhost:5000/api/v1/supplier/createSupplier
router.post("/createSupplier", createSupplier);
router.put("/updateSupplierInfo/:id", updateSupplierInfo);
router.delete("/deleteSupplier/:id", deleteSupplier);
router.get("/getAllSupplier",getAllSupplier);
router.get("/getSupplierById/:id", getSupplierById)


module.exports = router;

