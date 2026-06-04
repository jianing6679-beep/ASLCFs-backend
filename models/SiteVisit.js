const mongoose = require('mongoose');

const siteVisitSchema = new mongoose.Schema({
  page: {
    type: String,
    trim: true,
    default: ''
  },
  path: {
    type: String,
    trim: true,
    default: ''
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
  },
  referrer: {
    type: String,
    trim: true,
    default: ''
  },
  visitorId: {
    type: String,
    trim: true,
    default: ''
  }
}, {
  timestamps: true
});

siteVisitSchema.index({ createdAt: -1 });
siteVisitSchema.index({ page: 1, createdAt: -1 });
siteVisitSchema.index({ visitorId: 1, createdAt: -1 });

module.exports = mongoose.model('SiteVisit', siteVisitSchema);
