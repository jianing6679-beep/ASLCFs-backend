const mongoose = require('mongoose');

const citationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  paperTitle: {
    type: String,
    required: true,
    trim: true
  },
  journalName: {
    type: String,
    required: true,
    trim: true
  },
  publicationYear: {
    type: Number,
    required: true,
    min: 2000,
    max: 2100
  },
  doi: {
    type: String,
    trim: true
  },
  authors: {
    type: String,
    required: true
  },
  volume: String,
  issue: String,
  pages: String,
  dataTypes: [{
    type: String,
    enum: ['emission']
  }],
  abstract: String,
  submittedAt: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  reviewNote: String
});

citationSchema.index({ userId: 1, submittedAt: -1 });
citationSchema.index({ status: 1 });
citationSchema.index({ dataTypes: 1 });

module.exports = mongoose.model('Citation', citationSchema);
