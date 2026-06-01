const mongoose = require('mongoose');

const downloadLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  dataType: {
    type: String,
    enum: ['emission'],
    required: true
  },
  filters: {
    year: String,
    mainCategory: String,
    category: String,
    subcategory: String,
    species: [String],
    scale: String
  },
  fileList: [{
    fileName: String,
    fileSize: Number,
    fileUrl: String
  }],
  downloadTime: {
    type: Date,
    default: Date.now
  },
  ipAddress: String,
  userAgent: String
});

downloadLogSchema.index({ userId: 1, downloadTime: -1 });
downloadLogSchema.index({ dataType: 1, downloadTime: -1 });

module.exports = mongoose.model('DownloadLog', downloadLogSchema);
