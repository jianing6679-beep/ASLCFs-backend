if (String(process.env.DB_MODE || '').toLowerCase() === 'sql') {
  module.exports = require('./sql/InventoryFile');
  return;
}

const mongoose = require('mongoose');

const inventoryFileSchema = new mongoose.Schema({
  dataType: {
    type: String,
    enum: {
      values: ['emission'],
      message: 'dataType must be emission'
    },
    default: 'emission',
    index: true
  },
  title: {
    type: String,
    required: [true, 'File title is required'],
    trim: true,
    maxlength: [120, 'File title cannot exceed 120 characters']
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
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'File description cannot exceed 500 characters'],
    default: ''
  },
  originalFilename: {
    type: String,
    required: [true, 'Original filename is required'],
    trim: true
  },
  storedFilename: {
    type: String,
    required: [true, 'Stored filename is required'],
    trim: true
  },
  relativePath: {
    type: String,
    required: [true, 'File path is required'],
    trim: true
  },
  mimeType: {
    type: String,
    trim: true,
    default: 'application/octet-stream'
  },
  extension: {
    type: String,
    trim: true,
    default: 'tif'
  },
  size: {
    type: Number,
    required: true,
    min: [1, 'File size must be greater than 0']
  },
  pollutant: {
    type: String,
    trim: true,
    default: ''
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
  period: {
    type: String,
    trim: true,
    default: ''
  },
  scale: {
    type: String,
    enum: {
      values: ['annual', 'monthly', 'daily', 'hourly', 'other', ''],
      message: 'Invalid scale'
    },
    default: 'annual'
  },
  version: {
    type: String,
    trim: true,
    default: 'v1'
  },
  developer: {
    type: String,
    trim: true,
    default: '开发团队占位符'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  isPublished: {
    type: Boolean,
    default: false
  },
  downloadCount: {
    type: Number,
    default: 0
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

inventoryFileSchema.index({ dataType: 1, datasetKey: 1, isPublished: 1, year: -1, category: 1, updatedAt: -1 });
inventoryFileSchema.index({ title: 'text', datasetName: 'text', description: 'text', pollutant: 'text', subject: 'text', originalFilename: 'text' });

module.exports = mongoose.model('InventoryFile', inventoryFileSchema);
