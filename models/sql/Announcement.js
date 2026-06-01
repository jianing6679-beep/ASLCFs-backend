const { createModel } = require('./query');

module.exports = createModel({
  table: 'announcements',
  fields: ['_id', 'text', 'lang', 'order', 'isActive', 'createdAt', 'updatedAt']
});
