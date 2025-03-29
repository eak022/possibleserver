const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const StatusSchema = new Schema({
    statusName: { type: String, required: true }
  }, { timestamps: true });
  
  const StatusModel = model("Status", StatusSchema);
  module.exports = StatusModel
  