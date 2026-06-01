if (String(process.env.DB_MODE || '').toLowerCase() === 'sql') {
  module.exports = require('./sql/DownloadHistory');
  return;
}

const mongoose = require('mongoose');

const downloadHistorySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  username: {
    type: String,
    trim: true,
    default: ''
  },
  email: {
    type: String,
    trim: true,
    default: ''
  },
  dataType: {
    type: String,
    trim: true,
    default: 'emission'
  },
  dataTypeLabel: {
    type: String,
    trim: true,
    default: '排放数据'
  },
  datasetKey: {
    type: String,
    trim: true,
    lowercase: true,
    default: ''
  },
  datasetName: {
    type: String,
    trim: true,
    default: ''
  },
  downloadType: {
    type: String,
    enum: ['single', 'batch'],
    default: 'single'
  },
  filename: {
    type: String,
    trim: true,
    required: true
  },
  filePath: {
    type: String,
    trim: true,
    default: ''
  },
  fileCount: {
    type: Number,
    default: 1
  },
  fileSize: {
    type: Number,
    default: 0
  },
  year: {
    type: String,
    trim: true,
    default: ''
  },
  category: {
    type: String,
    trim: true,
    default: ''
  },
  subject: {
    type: String,
    trim: true,
    default: ''
  },
  scale: {
    type: String,
    trim: true,
    default: ''
  },
  filters: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  inventoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InventoryFile'
  },
  ip: {
    type: String,
    trim: true,
    default: ''
  },
  userAgent: {
    type: String,
    trim: true,
    default: ''
  }
}, {
  timestamps: true
});

downloadHistorySchema.index({ user: 1, createdAt: -1 });
downloadHistorySchema.index({ dataType: 1, datasetKey: 1, createdAt: -1 });
downloadHistorySchema.index({ filename: 'text', datasetName: 'text', subject: 'text', category: 'text' });

module.exports = mongoose.model('DownloadHistory', downloadHistorySchema);
