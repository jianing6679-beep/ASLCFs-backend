const { createModel } = require('./query');

module.exports = createModel({
  table: 'download_histories',
  fields: [
    '_id', 'user', 'username', 'email', 'dataType', 'dataTypeLabel',
    'datasetKey', 'datasetName', 'downloadType', 'filename', 'filePath',
    'fileCount', 'fileSize', 'year', 'category', 'subject', 'scale',
    'filters', 'inventoryId', 'ip', 'userAgent', 'createdAt', 'updatedAt'
  ]
});
