const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const archiver = require('archiver');
const { auth } = require('../middleware/auth');
const DownloadHistory = require('../models/DownloadHistory');

const router = express.Router();
const dataRoot = path.join(__dirname, '..', '..', 'data');
const agricultureRoot = path.join(dataRoot, '\u519c\u4e1a\u6392\u653e\u6e05\u5355');
const otherEmissionRoot = path.join(dataRoot, '\u5176\u4ed6\u6392\u653e\u6e05\u5355');
const ALLOWED_POLLUTANTS = new Set(['NH3', 'CH4', 'NOx', 'HONO']);
const ALLOWED_PASSENGER_CAR_POLLUTANTS = new Set(['CO', 'NH3', 'NOx', 'PM', 'VOC']);
const EXPRESS_DELIVERY_ZENODO_URL = 'https://zenodo.org/records/20528292/files/%E5%BF%AB%E9%80%92%E4%B8%9A%E9%81%93%E8%B7%AF%E5%B0%BA%E5%BA%A6%E6%8E%92%E6%94%BE%E6%B8%85%E5%8D%95.zip?download=1';
const EXPRESS_DELIVERY_ZIP_FILENAME = '\u5feb\u9012\u4e1a\u9053\u8def\u5c3a\u5ea6\u6392\u653e\u6e05\u5355.zip';
const ALLOWED_YEARS = new Set(Array.from({ length: 24 }, (_, index) => String(2000 + index)));
const CATEGORY_TIME = '\u65f6\u95f4';
const CATEGORY_SPECIES = '\u7269\u79cd';
const CATEGORY_TIME_NEW = '\u65f6\u95f4\u5206\u89e3';
const CATEGORY_SPECIES_NEW = '\u7269\u79cd\u5206\u89e3';
const CATEGORY_CROP_NEW = '\u4f5c\u7269\u5206\u89e3';
const CATEGORY_METHANE_SOURCE = '\u7532\u70f7\u6765\u6e90\u5206\u89e3';
const SECTOR_LIVESTOCK = '\u755c\u7267\u4e1a';
const SECTOR_PLANTING = '\u79cd\u690d\u4e1a';
const SECTOR_METHANE_SOURCE = '\u7532\u70f7\u6765\u6e90';
const PLANTING_MONTHLY_DIRS = ['\u6708\u5ea6\u5206\u5e03', 'newmonth'];
const PLANTING_ANNUAL_DIRS = ['\u5e74\u5ea6\u5206\u5e03', 'newyear'];
const ALLOWED_CATEGORIES = new Set([CATEGORY_TIME, CATEGORY_SPECIES, CATEGORY_TIME_NEW, CATEGORY_SPECIES_NEW, CATEGORY_CROP_NEW, CATEGORY_METHANE_SOURCE]);
const ALLOWED_SECTORS = new Set([SECTOR_LIVESTOCK, SECTOR_PLANTING, SECTOR_METHANE_SOURCE]);

// \u6620\u5c04\u65b0\u5206\u7c7b\u540d\u79f0\u5230\u6587\u4ef6\u7cfb\u7edf\u8def\u5f84
const categoryToPath = {
  '\u65f6\u95f4': '\u6708\u5ea6\u5206\u5e03',
  '\u7269\u79cd': '\u755c\u7267\u7269\u79cd',
  '\u65f6\u95f4\u5206\u89e3': '\u6708\u5ea6\u5206\u5e03',
  '\u7269\u79cd\u5206\u89e3': '\u755c\u7267\u7269\u79cd'
};

const methaneSourceFolderBySubject = {
  '\u7532\u70f7\u603b\u6392\u653e\u91cf': '\u603b\u6392\u653e\u91cf',
  '\u6c34\u7a3b\u79cd\u690d': '\u6c34\u7a3b\u79cd\u690d',
  '\u7caa\u4fbf\u7ba1\u7406': '\u7caa\u4fbf\u7ba1\u7406',
  '\u80a0\u9053\u53d1\u9175': '\u80a0\u9053\u53d1\u9175'
};

const getClientIp = (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '';

const getSector = (value = '') => {
  const sector = String(value || '').trim();
  return ALLOWED_SECTORS.has(sector) ? sector : SECTOR_LIVESTOCK;
};

const getEmissionDirectoryCandidates = ({ pollutant, sector, year, categoryPath, scale, filename, subject }) => {
  if (pollutant === 'HONO') {
    return [path.join(agricultureRoot, pollutant)];
  }

  if (pollutant === 'CH4' && categoryPath === CATEGORY_METHANE_SOURCE) {
    const sourceSubject = String(subject || '').trim() || String(filename || '').replace(/_\d{4}\.tiff?$/i, '');
    const folder = methaneSourceFolderBySubject[sourceSubject] || sourceSubject;
    return [path.join(agricultureRoot, pollutant, folder)];
  }

  if (sector === SECTOR_PLANTING) {
    const isMonthlyFile = new RegExp(`^${year}_\\d{2}_`, 'i').test(String(filename || ''));
    if (scale === 'monthly' || isMonthlyFile) {
      return PLANTING_MONTHLY_DIRS.map(dir => path.join(agricultureRoot, pollutant, sector, dir, year));
    }
    if (scale === 'annual') {
      return PLANTING_ANNUAL_DIRS.map(dir => path.join(agricultureRoot, pollutant, sector, dir, year));
    }
    return [
      ...PLANTING_ANNUAL_DIRS.map(dir => path.join(agricultureRoot, pollutant, sector, dir, year)),
      ...PLANTING_MONTHLY_DIRS.map(dir => path.join(agricultureRoot, pollutant, sector, dir, year))
    ];
  }

  return [path.join(agricultureRoot, pollutant, sector, year, categoryPath)];
};

const getBatchEmissionDirectoryCandidates = ({ pollutant, sector, year, categoryPath, scale, subjects }) => {
  if (pollutant === 'CH4' && categoryPath === CATEGORY_METHANE_SOURCE) {
    return [...new Set(subjects
      .map(subject => methaneSourceFolderBySubject[String(subject).trim()] || String(subject).trim())
      .filter(Boolean)
      .map(folder => path.join(agricultureRoot, pollutant, folder)))];
  }

  return getEmissionDirectoryCandidates({ pollutant, sector, year, categoryPath, scale });
};

const resolveExistingDirectory = async (candidates) => {
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return candidate;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  return candidates[0];
};

const getPollutantConfig = (value = 'NH3') => {
  const pollutant = String(value || 'NH3').trim();
  const safePollutant = ALLOWED_POLLUTANTS.has(pollutant) ? pollutant : 'NH3';
  return {
    pollutant: safePollutant,
    mainCategory: `${safePollutant}鎺掓斁娓呭崟`
  };
};

const createDownloadHistory = (req, payload) => {
  if (!req.user) return Promise.resolve();

  return DownloadHistory.create({
    user: req.user._id,
    username: req.user.username || '',
    email: req.user.email || '',
    ip: getClientIp(req),
    userAgent: req.get('user-agent') || '',
    ...payload
  }).catch((error) => {
    console.error('Create download history error:', error);
  });
};

router.get('/history', auth, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const query = { user: req.user._id };

    if (req.query.dataType) query.dataType = String(req.query.dataType);
    if (req.query.year) query.year = String(req.query.year);
    if (req.query.category) query.category = String(req.query.category);
    if (req.query.keyword) {
      const pattern = String(req.query.keyword).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { filename: { $regex: pattern, $options: 'i' } },
        { datasetName: { $regex: pattern, $options: 'i' } },
        { subject: { $regex: pattern, $options: 'i' } },
        { category: { $regex: pattern, $options: 'i' } }
      ];
    }
    if (req.query.dateFrom || req.query.dateTo) {
      query.createdAt = {};
      if (req.query.dateFrom) query.createdAt.$gte = new Date(req.query.dateFrom);
      if (req.query.dateTo) query.createdAt.$lte = new Date(req.query.dateTo);
    }

    const [items, total] = await Promise.all([
      DownloadHistory.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      DownloadHistory.countDocuments(query)
    ]);

    res.json({
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
      }
    });
  } catch (error) {
    console.error('Get download history error:', error);
    res.status(500).json({ error: '鑾峰彇涓嬭浇鍘嗗彶澶辫触' });
  }
});

router.get('/emission/file', auth, async (req, res) => {
  try {
    const year = String(req.query.year || '');
    const { pollutant, mainCategory } = getPollutantConfig(req.query.pollutant);
    const sector = getSector(req.query.sector);
    const category = String(req.query.category || '');
    const subject = String(req.query.subject || '').trim();
    const filename = path.basename(String(req.query.filename || ''));

    if (!ALLOWED_YEARS.has(year)) {
      return res.status(400).json({ error: 'Invalid year parameter.' });
    }

    if (!ALLOWED_CATEGORIES.has(category)) {
      return res.status(400).json({ error: 'Invalid category parameter.' });
    }

    if (!filename || !/\.tiff?$/i.test(filename)) {
      return res.status(400).json({ error: 'Invalid filename.' });
    }

    const categoryPath = categoryToPath[category] || category;
    const directoryPath = await resolveExistingDirectory(getEmissionDirectoryCandidates({
      pollutant,
      sector,
      year,
      categoryPath,
      scale: String(req.query.scale || ''),
      filename,
      subject
    }));
    const filePath = path.resolve(directoryPath, filename);
    const relativePath = path.relative(directoryPath, filePath);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return res.status(400).json({ error: 'Invalid file path.' });
    }

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return res.status(404).json({ error: 'File not found.' });
    }

    await createDownloadHistory(req, {
      dataType: 'emission',
      dataTypeLabel: 'Emission data',
      datasetKey: 'agriculture_emission',
      datasetName: '\u519c\u4e1a\u6392\u653e\u6e05\u5355',
      downloadType: 'single',
      filename,
      filePath: path.relative(dataRoot, filePath),
      fileCount: 1,
      fileSize: stat.size,
      year,
      mainCategory,
      sector,
      category,
      subject,
      scale: String(req.query.scale || ''),
      filters: {
        year,
        pollutant,
        mainCategory,
        sector,
        datasetKey: 'agriculture_emission',
        datasetName: '\u519c\u4e1a\u6392\u653e\u6e05\u5355',
        category,
        subject,
        scale: String(req.query.scale || '')
      }
    });

    return res.download(filePath, filename);
  } catch (error) {
    console.error('Single emission download error:', error);
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found.' });
    }
    return res.status(500).json({ error: 'Download failed.' });
  }
});

router.get('/other/file', auth, async (req, res) => {
  try {
    const datasetKey = String(req.query.datasetKey || '');
    const datasetName = String(req.query.datasetName || '');
    const subject = String(req.query.subject || '');
    const pollutant = String(req.query.pollutant || '').trim();
    const year = String(req.query.year || '');
    const period = String(req.query.period || '');
    const scale = String(req.query.scale || '');
    const filename = path.basename(String(req.query.filename || ''));

    if (datasetKey !== 'other_emission' || datasetName !== '\u5176\u4ed6\u6392\u653e\u6e05\u5355') {
      return res.status(400).json({ error: 'Invalid dataset parameters.' });
    }

    if (subject !== '\u4e58\u7528\u8f66') {
      return res.status(400).json({ error: 'Invalid download target.' });
    }

    if (!ALLOWED_PASSENGER_CAR_POLLUTANTS.has(pollutant)) {
      return res.status(400).json({ error: 'Invalid pollutant parameter.' });
    }

    if (year !== '2019' || !/^(0[1-9]|1[0-2])$/.test(period) || scale !== 'monthly') {
      return res.status(400).json({ error: 'Invalid time parameters.' });
    }

    if (!filename || !/^emission_2019-(0[1-9]|1[0-2])_monthly\.tiff?$/i.test(filename)) {
      return res.status(400).json({ error: 'Invalid filename.' });
    }

    const directoryPath = path.join(otherEmissionRoot, '\u4e58\u7528\u8f66\u6392\u653e\u6e05\u5355', pollutant);
    const filePath = path.resolve(directoryPath, filename);
    const relativePath = path.relative(directoryPath, filePath);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return res.status(400).json({ error: 'Invalid file path.' });
    }

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return res.status(404).json({ error: 'File not found.' });
    }

    await createDownloadHistory(req, {
      dataType: 'emission',
      dataTypeLabel: 'Emission data',
      datasetKey: 'other_emission',
      datasetName: '\u5176\u4ed6\u6392\u653e\u6e05\u5355',
      downloadType: 'single',
      filename,
      filePath: path.relative(dataRoot, filePath),
      fileCount: 1,
      fileSize: stat.size,
      year,
      mainCategory: '\u4e58\u7528\u8f66\u6392\u653e\u6e05\u5355',
      sector: '\u4e58\u7528\u8f66',
      category: '\u6c61\u67d3\u7269\u5206\u89e3',
      subject,
      pollutant,
      scale,
      period,
      filters: {
        year,
        pollutant,
        datasetKey: 'other_emission',
        datasetName: '\u5176\u4ed6\u6392\u653e\u6e05\u5355',
        mainCategory: '\u4e58\u7528\u8f66\u6392\u653e\u6e05\u5355',
        subject,
        scale,
        period
      }
    });

    return res.download(filePath, filename);
  } catch (error) {
    console.error('Other emission download error:', error);
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found.' });
    }
    return res.status(500).json({ error: 'Download failed.' });
  }
});
router.post('/other/batch', auth, async (req, res) => {
  try {
    const datasetKey = String(req.body?.datasetKey || '');
    const datasetName = String(req.body?.datasetName || '');
    const mainCategory = String(req.body?.mainCategory || '');
    const subject = String(req.body?.subject || '');
    const year = String(req.body?.year || '');
    const scale = String(req.body?.scale || '');
    const pollutants = Array.isArray(req.body?.pollutants)
      ? [...new Set(req.body.pollutants.map(item => String(item).trim()).filter(Boolean))]
      : [];
    const periods = Array.isArray(req.body?.periods)
      ? [...new Set(req.body.periods.map(item => String(item).trim()).filter(Boolean))]
      : [];

    if (datasetKey !== 'other_emission' || datasetName !== '\u5176\u4ed6\u6392\u653e\u6e05\u5355') {
      return res.status(400).json({ error: 'Invalid dataset parameters.' });
    }

    if (mainCategory === '\u5feb\u9012\u4e1a\u9053\u8def\u5c3a\u5ea6\u6392\u653e\u6e05\u5355') {
      await createDownloadHistory(req, {
        dataType: 'emission',
        dataTypeLabel: 'Emission data',
        datasetKey: 'other_emission',
        datasetName: '\u5176\u4ed6\u6392\u653e\u6e05\u5355',
        downloadType: 'single',
        filename: EXPRESS_DELIVERY_ZIP_FILENAME,
        filePath: EXPRESS_DELIVERY_ZENODO_URL,
        fileCount: 1,
        fileSize: 0,
        mainCategory,
        sector: '\u5feb\u9012\u4e1a',
        category: '\u9053\u8def\u5c3a\u5ea6\u6392\u653e\u6e05\u5355',
        subject: '\u5feb\u9012\u4e1a',
        scale: 'zip',
        filters: {
          datasetKey,
          datasetName,
          mainCategory,
          subject: '\u5feb\u9012\u4e1a',
          scale: 'zip',
          zenodoUrl: EXPRESS_DELIVERY_ZENODO_URL,
          source: 'zenodo'
        }
      });

      return res.json({
        message: 'Zenodo download request recorded.',
        filename: EXPRESS_DELIVERY_ZIP_FILENAME,
        zenodoUrl: EXPRESS_DELIVERY_ZENODO_URL
      });
    }

    if (mainCategory !== '\u4e58\u7528\u8f66\u6392\u653e\u6e05\u5355' || subject !== '\u4e58\u7528\u8f66') {
      return res.status(400).json({ error: 'Invalid download target.' });
    }

    if (year !== '2019' || scale !== 'monthly') {
      return res.status(400).json({ error: 'Invalid time parameters.' });
    }

    if (!pollutants.length || pollutants.some(pollutant => !ALLOWED_PASSENGER_CAR_POLLUTANTS.has(pollutant))) {
      return res.status(400).json({ error: 'Invalid pollutant parameters.' });
    }

    if (!periods.length || periods.some(period => !/^(0[1-9]|1[0-2])$/.test(period))) {
      return res.status(400).json({ error: 'Invalid month parameters.' });
    }

    const files = [];
    for (const pollutant of pollutants) {
      const directoryPath = path.join(otherEmissionRoot, '\u4e58\u7528\u8f66\u6392\u653e\u6e05\u5355', pollutant);
      for (const period of periods) {
        const filename = `emission_${year}-${period}_monthly.tif`;
        const filePath = path.resolve(directoryPath, filename);
        const relativePath = path.relative(directoryPath, filePath);

        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
          return res.status(400).json({ error: 'Invalid file path.' });
        }

        try {
          const stat = await fs.stat(filePath);
          if (stat.isFile()) {
            files.push({
              name: `${pollutant}/${filename}`,
              fullPath: filePath,
              size: stat.size
            });
          }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    }

    if (!files.length) {
      return res.status(404).json({ error: 'No matching files found.' });
    }

    const zipFilename = `other_emission_passenger_car_${year}_${pollutants.join('-')}_${periods.join('-')}_${Date.now()}.zip`;
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);

    await createDownloadHistory(req, {
      dataType: 'emission',
      dataTypeLabel: 'Emission data',
      datasetKey: 'other_emission',
      datasetName: '\u5176\u4ed6\u6392\u653e\u6e05\u5355',
      downloadType: 'batch',
      filename: zipFilename,
      filePath: path.join('\u5176\u4ed6\u6392\u653e\u6e05\u5355', '\u4e58\u7528\u8f66\u6392\u653e\u6e05\u5355'),
      fileCount: files.length,
      fileSize: totalSize,
      year,
      mainCategory,
      sector: subject,
      category: '\u6c61\u67d3\u7269\u5206\u89e3',
      subject,
      pollutant: pollutants.join(', '),
      scale,
      period: periods.join(', '),
      filters: {
        year,
        pollutants,
        periods,
        datasetKey: 'other_emission',
        datasetName: '\u5176\u4ed6\u6392\u653e\u6e05\u5355',
        mainCategory,
        subject,
        scale
      }
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
    res.setHeader('X-File-Count', String(files.length));

    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (error) => {
      console.error('Other batch archive error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create archive.' });
      } else {
        res.destroy(error);
      }
    });

    archive.pipe(res);
    files.forEach((file) => {
      archive.file(file.fullPath, { name: file.name });
    });
    await archive.finalize();
  } catch (error) {
    console.error('Other batch download error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: `Server error: ${error.message}` });
    }
  }
});

router.post('/emission/batch', auth, async (req, res) => {
  try {
    const { year, category, subjects, scale } = req.body || {};
    const { pollutant, mainCategory } = getPollutantConfig(req.body?.pollutant);
    const sector = getSector(req.body?.sector);
    const years = Array.isArray(req.body?.years)
      ? [...new Set(req.body.years.map(item => String(item).trim()).filter(Boolean))]
      : [String(year || '').trim()].filter(Boolean);

    if (!years.length || years.some(item => !ALLOWED_YEARS.has(item))) {
      return res.status(400).json({ error: 'Invalid year parameter.' });
    }

    if (!ALLOWED_CATEGORIES.has(String(category))) {
      return res.status(400).json({ error: 'Invalid category parameter.' });
    }

    if (!Array.isArray(subjects) || subjects.length === 0) {
      return res.status(400).json({ error: 'Please select at least one download target.' });
    }

    const normalizedScale = ['all', 'annual', 'monthly'].includes(String(scale))
      ? String(scale)
      : 'all';

    const categoryPath = categoryToPath[String(category)] || String(category);
    const normalizedSubjects = [...new Set(subjects.map(item => String(item).trim()).filter(Boolean))];
    const files = (await Promise.all(years.map(async (itemYear) => {
      const directoryCandidates = getBatchEmissionDirectoryCandidates({
        pollutant,
        sector,
        year: itemYear,
        categoryPath,
        scale: normalizedScale,
        subjects: normalizedSubjects
      });

      return (await Promise.all(directoryCandidates.map(async (candidate) => {
        try {
          await fs.access(candidate);
          const matchedFiles = await collectMatchingFiles({
            directoryPath: candidate,
            year: itemYear,
            pollutant,
            category: String(category),
            subjects: normalizedSubjects,
            scale: normalizedScale
          });
          return matchedFiles.map(file => ({
            ...file,
            archiveName: path.join(itemYear, file.name)
          }));
        } catch (error) {
          if (error.code === 'ENOENT') return [];
          throw error;
        }
      }))).flat();
    }))).flat();

    if (files.length === 0) {
      return res.status(404).json({ error: 'No matching files found.' });
    }

    const subjectSummary = files.length > 20
      ? `${subjects.length}items`
      : subjects.join('_');
    const yearSummary = years.length > 3 ? `${years.length}years` : years.join('-');
    const zipFilename = `emission_${pollutant}_${yearSummary}_${encodeURIComponent(category)}_${encodeURIComponent(subjectSummary)}_${Date.now()}.zip`;

    await createDownloadHistory(req, {
      dataType: 'emission',
      dataTypeLabel: 'Emission data',
      datasetKey: 'agriculture_emission',
      datasetName: '\u519c\u4e1a\u6392\u653e\u6e05\u5355',
      downloadType: 'batch',
      filename: zipFilename,
      filePath: path.join(agricultureRoot, pollutant),
      fileCount: files.length,
      year: years.join(', '),
      mainCategory,
      sector,
      category: String(category),
      subject: subjects.join(', '),
      scale: normalizedScale,
      filters: {
        years,
        pollutant,
        mainCategory,
        sector,
        datasetKey: 'agriculture_emission',
        datasetName: '\u519c\u4e1a\u6392\u653e\u6e05\u5355',
        category: String(category),
        subjects,
        scale: normalizedScale
      }
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
    res.setHeader('X-File-Count', String(files.length));

    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (error) => {
      console.error('Archive error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create archive.' });
      } else {
        res.destroy(error);
      }
    });

    archive.pipe(res);

    files.forEach((file) => {
      archive.file(file.fullPath, { name: file.archiveName || file.name });
    });

    await archive.finalize();
  } catch (error) {
    console.error('Batch download error:', error);
    if (!res.headersSent) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ error: 'Download directory or files not found.' });
      }
      return res.status(500).json({ error: `Server error: ${error.message}` });
    }
  }
});

router.post('/zenodo-request', auth, async (req, res) => {
  try {
    const filename = path.basename(String(req.body?.filename || ''));
    const zenodoUrl = String(req.body?.zenodoUrl || '').trim();
    const filters = req.body?.filters && typeof req.body.filters === 'object'
      ? req.body.filters
      : {};

    if (!filename || !/\.(tiff?|zip)$/i.test(filename)) {
      return res.status(400).json({ error: 'Invalid filename.' });
    }

    if (!/^https:\/\/zenodo\.org\/records\/\d+\/files\/.+/i.test(zenodoUrl)) {
      return res.status(400).json({ error: 'Invalid Zenodo URL.' });
    }

    await createDownloadHistory(req, {
      dataType: 'emission',
      dataTypeLabel: 'Emission data',
      datasetKey: String(req.body?.datasetKey || filters.datasetKey || 'agriculture_emission'),
      datasetName: String(req.body?.datasetName || filters.datasetName || '\u519c\u4e1a\u6392\u653e\u6e05\u5355'),
      downloadType: 'single',
      filename,
      filePath: zenodoUrl,
      fileCount: Number(req.body?.fileCount || 1),
      fileSize: 0,
      year: String(req.body?.year || filters.year || ''),
      mainCategory: String(req.body?.mainCategory || filters.mainCategory || ''),
      sector: String(req.body?.sector || filters.sector || ''),
      category: String(req.body?.category || filters.category || ''),
      subject: String(req.body?.subject || filters.subject || ''),
      scale: String(req.body?.scale || filters.scale || ''),
      period: String(req.body?.period || filters.period || ''),
      filters: {
        ...filters,
        zenodoUrl,
        source: 'zenodo'
      }
    });

    res.json({
      message: 'Zenodo download request recorded.',
      filename,
      zenodoUrl
    });
  } catch (error) {
    console.error('Zenodo download request error:', error);
    res.status(500).json({ error: 'Failed to record Zenodo download request.' });
  }
});

async function collectMatchingFiles({ directoryPath, year, pollutant, category, subjects, scale }) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const filename = entry.name;
    const extension = path.extname(filename).toLowerCase();
    if (extension !== '.tif' && extension !== '.tiff') continue;
    const pollutantPattern = new RegExp(`(^|_)${String(pollutant).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|_)`, 'i');
    if (pollutant !== 'CH4' && !pollutantPattern.test(path.basename(filename, extension))) continue;
    if (!(pollutant === 'CH4' && category === CATEGORY_METHANE_SOURCE) && !subjects.some(subject => filename.includes(subject))) continue;
    if (!matchesScale({ filename, year, category, scale })) continue;

    files.push({
      name: filename,
      fullPath: path.join(directoryPath, filename)
    });
  }

  files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return files;
}

function matchesScale({ filename, year, category, scale }) {
  if (scale === 'all') return true;

  if (category === CATEGORY_METHANE_SOURCE) {
    const annualPattern = new RegExp(`(^|_)${year}(_|\\.tiff?$)`, 'i');
    if (scale === 'annual') return annualPattern.test(filename);
    return false;
  }

  // 鏀寔鏂版棫鍒嗙被鍚嶇О
  const isTimeCategory = category === CATEGORY_TIME || category === CATEGORY_TIME_NEW;

  if (isTimeCategory) {
    const monthlyPattern = new RegExp(`^${year}_\\d{2}_.+\\.tiff?$`, 'i');
    const annualPattern = new RegExp(`^${year}_[^_]+_.+\\.tiff?$`, 'i');

    if (scale === 'annual') return annualPattern.test(filename) && !monthlyPattern.test(filename);
    if (scale === 'monthly') return monthlyPattern.test(filename);
    return false;
  }

  const monthlyPattern = new RegExp(`^${year}_\\d{2}_.+\\.tiff?$`, 'i');
  const annualPattern = new RegExp(`^${year}_[^_]+_.+\\.tiff?$`, 'i');

  if (scale === 'annual') return annualPattern.test(filename);
  if (scale === 'monthly') return monthlyPattern.test(filename);
  return false;
}

module.exports = router;
