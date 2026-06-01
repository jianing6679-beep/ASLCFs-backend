if (String(process.env.DB_MODE || '').toLowerCase() === 'sql') {
  module.exports = require('./sql/Announcement');
  return;
}

const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
  text: {
    type: String,
    required: [true, '公告内容不能为空'],
    trim: true,
    maxlength: [200, '公告内容最多200个字符']
  },
  lang: {
    type: String,
    enum: ['zh', 'en', 'fr', 'es', 'ru', 'ar'],
    default: 'zh'
  },
  order: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

announcementSchema.index({ lang: 1, isActive: 1, order: 1, createdAt: -1 });

module.exports = mongoose.model('Announcement', announcementSchema);
