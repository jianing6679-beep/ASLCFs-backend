const { createModel } = require('./query');

module.exports = createModel({
  table: 'inventory_files',
  fields: [
    '_id', 'dataType', 'title', 'datasetKey', 'datasetName', 'description',
    'originalFilename', 'storedFilename', 'relativePath', 'mimeType', 'extension',
    'size', 'pollutant', 'year', 'category', 'subject', 'period', 'scale',
    'version', 'developer', 'metadata', 'isPublished', 'downloadCount',
    'uploadedBy', 'createdAt', 'updatedAt'
  ]
});
