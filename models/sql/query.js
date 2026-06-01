const { getPool, createId } = require('../../db/sql');

const BOOL_FIELDS = new Set(['isActive', 'emailVerified', 'isPublished']);
const JSON_FIELDS = new Set(['profile', 'metadata', 'filters']);
const DATE_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'emailVerifyExpires',
  'passwordResetExpires',
  'approvedAt',
  'rejectedAt',
  'lastLogin',
  'lockUntil'
]);
const DEFAULT_HIDDEN_FIELDS = new Set([
  'password',
  'emailVerifyToken',
  'passwordResetToken'
]);

const normalizeValue = (field, value) => {
  const rootField = String(field || '').split('.')[0];
  if (value === undefined) return null;
  if (BOOL_FIELDS.has(rootField)) return value ? 1 : 0;
  if (JSON_FIELDS.has(rootField)) return JSON.stringify(value || {});
  if (DATE_FIELDS.has(rootField)) return value ? new Date(value) : null;
  return value;
};

const quoteIdentifier = (field) => `\`${String(field).replace(/`/g, '``')}\``;

const getAllowedFieldRoots = (model) => new Set([...(model.fields || []), ...JSON_FIELDS]);

const assertSafeField = (model, field) => {
  const value = String(field || '');
  const parts = value.split('.');
  const rootField = parts[0];

  if (!/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/.test(value)) {
    throw new Error(`Unsafe SQL field: ${value}`);
  }

  const allowedRoots = getAllowedFieldRoots(model);
  if (!allowedRoots.has(rootField)) {
    throw new Error(`Unknown SQL field: ${value}`);
  }

  if (parts.length > 1 && !JSON_FIELDS.has(rootField)) {
    throw new Error(`Nested SQL field is not allowed: ${value}`);
  }

  return value;
};

const getJsonPathParts = (field = '') => {
  const parts = String(field).split('.');
  if (parts.length < 2 || !JSON_FIELDS.has(parts[0])) return null;
  return parts;
};

const toJsonPath = (parts = []) => `$.${parts.slice(1).map(part => String(part).replace(/\\/g, '\\\\').replace(/"/g, '\\"')).join('.')}`;

const toSqlField = (field, model) => {
  const safeField = model ? assertSafeField(model, field) : field;
  const jsonParts = getJsonPathParts(safeField);
  if (jsonParts) {
    return `JSON_UNQUOTE(JSON_EXTRACT(${quoteIdentifier(jsonParts[0])}, '${toJsonPath(jsonParts)}'))`;
  }
  return quoteIdentifier(safeField);
};

const inflateRow = (row) => {
  if (!row) return null;
  const item = { ...row, id: row._id };
  BOOL_FIELDS.forEach((field) => {
    if (field in item) item[field] = Boolean(item[field]);
  });
  JSON_FIELDS.forEach((field) => {
    if (typeof item[field] === 'string') {
      try {
        item[field] = JSON.parse(item[field] || '{}');
      } catch (error) {
        item[field] = {};
      }
    }
    if (item[field] == null) item[field] = {};
  });
  return item;
};

const toSqlOrder = (sort = {}, model) => {
  const entries = Object.entries(sort || {});
  if (!entries.length) return '';
  return ` ORDER BY ${entries.map(([field, dir]) => `${toSqlField(field, model)} ${Number(dir) < 0 ? 'DESC' : 'ASC'}`).join(', ')}`;
};

const parseSelectSpec = (spec) => {
  if (!spec) return null;

  const tokens = Array.isArray(spec)
    ? spec
    : String(spec).split(/\s+/).filter(Boolean);

  if (!tokens.length) return null;

  const include = new Set();
  const exclude = new Set();
  const forceInclude = new Set();

  tokens.forEach((token) => {
    const value = String(token).trim();
    if (!value) return;

    if (value.startsWith('+')) {
      forceInclude.add(value.slice(1));
      return;
    }

    if (value.startsWith('-')) {
      exclude.add(value.slice(1));
      return;
    }

    include.add(value);
  });

  return { include, exclude, forceInclude };
};

const getSelectedFields = (model, selectSpec) => {
  const available = model.fields || [];
  if (!selectSpec) {
    return available.filter(field => !DEFAULT_HIDDEN_FIELDS.has(field));
  }

  const requestedRootFields = new Set(
    [...selectSpec.include, ...selectSpec.forceInclude]
      .map(field => String(field).split('.')[0])
      .filter(field => JSON_FIELDS.has(field))
  );
  const hasInclude = selectSpec.include.size > 0;
  const fields = hasInclude
    ? available.filter(field => selectSpec.include.has(field) || selectSpec.forceInclude.has(field) || requestedRootFields.has(field))
    : available.filter(field => !DEFAULT_HIDDEN_FIELDS.has(field) || selectSpec.forceInclude.has(field));

  return fields.filter(field => !selectSpec.exclude.has(field));
};

const getValueByPath = (item, path) => {
  return String(path || '').split('.').reduce((current, part) => {
    if (current == null) return undefined;
    return current[part];
  }, item);
};

const pickFields = (item, fields) => {
  if (!item || !fields.length) return item;

  const output = { _id: item._id, id: item.id || item._id };
  fields.forEach((field) => {
    const parts = field.split('.');
    let source = item;
    let target = output;

    parts.forEach((part, index) => {
      if (source == null || !(part in source)) {
        source = undefined;
        return;
      }

      if (index === parts.length - 1) {
        target[part] = source[part];
        return;
      }

      target[part] = target[part] || {};
      target = target[part];
      source = source[part];
    });
  });
  return output;
};

const getPopulateModel = (path) => {
  if (['uploadedBy', 'user', 'userId', 'approvedBy', 'rejectedBy'].includes(path)) {
    return require('./User');
  }
  return null;
};

const populateItems = async (items, specs) => {
  if (!specs.length || !items.length) return items;

  for (const spec of specs) {
    const PopulateModel = getPopulateModel(spec.path);
    if (!PopulateModel) continue;

    const ids = [...new Set(items.map(item => getValueByPath(item, spec.path)).filter(Boolean).map(String))];
    if (!ids.length) continue;

    const relatedItems = await PopulateModel.find({ _id: { $in: ids } }).select(spec.select || '-password').lean();
    const relatedMap = new Map(relatedItems.map(item => [String(item._id), item]));
    const selectedFields = String(spec.select || '').split(/\s+/).filter(Boolean).filter(field => !field.startsWith('-') && !field.startsWith('+'));

    items.forEach((item) => {
      const id = getValueByPath(item, spec.path);
      const related = relatedMap.get(String(id));
      item[spec.path] = related ? pickFields(related, selectedFields) : null;
    });
  }

  return items;
};

const buildWhere = (query = {}, model) => {
  const clauses = [];
  const params = [];

  Object.entries(query || {}).forEach(([field, value]) => {
    if (field === '$or' && Array.isArray(value)) {
      const orParts = [];
      value.forEach((condition) => {
        Object.entries(condition).forEach(([orField, orValue]) => {
          if (orValue && typeof orValue === 'object' && '$regex' in orValue) {
            orParts.push(`${toSqlField(orField, model)} LIKE ?`);
            params.push(`%${String(orValue.$regex).replace(/\\/g, '')}%`);
          } else {
            orParts.push(`${toSqlField(orField, model)} = ?`);
            params.push(normalizeValue(orField, orValue));
          }
        });
      });
      if (orParts.length) clauses.push(`(${orParts.join(' OR ')})`);
      return;
    }

    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      if (Array.isArray(value.$in)) {
        if (!value.$in.length) {
          clauses.push('1=0');
          return;
        }
        clauses.push(`${toSqlField(field, model)} IN (${value.$in.map(() => '?').join(',')})`);
        params.push(...value.$in.map(item => normalizeValue(field, item)));
      }
      if ('$ne' in value) {
        clauses.push(`${toSqlField(field, model)} <> ?`);
        params.push(normalizeValue(field, value.$ne));
      }
      if ('$gt' in value) {
        clauses.push(`${toSqlField(field, model)} > ?`);
        params.push(normalizeValue(field, value.$gt));
      }
      if ('$gte' in value) {
        clauses.push(`${toSqlField(field, model)} >= ?`);
        params.push(normalizeValue(field, value.$gte));
      }
      if ('$lte' in value) {
        clauses.push(`${toSqlField(field, model)} <= ?`);
        params.push(normalizeValue(field, value.$lte));
      }
      if ('$regex' in value) {
        clauses.push(`${toSqlField(field, model)} LIKE ?`);
        params.push(`%${String(value.$regex).replace(/\\/g, '')}%`);
      }
      return;
    }

    clauses.push(`${toSqlField(field, model)} = ?`);
    params.push(normalizeValue(field, value));
  });

  return {
    sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '',
    params
  };
};

class SqlQuery {
  constructor(model, query = {}, options = {}) {
    this.model = model;
    this.query = query;
    this.options = options;
    this.sortSpec = {};
    this.skipCount = 0;
    this.limitCount = null;
    this.selectSpec = null;
    this.populateSpecs = [];
  }

  sort(spec) {
    this.sortSpec = spec || {};
    return this;
  }

  skip(value) {
    this.skipCount = Number(value || 0);
    return this;
  }

  limit(value) {
    this.limitCount = Number(value || 0);
    return this;
  }

  select(spec) {
    this.selectSpec = parseSelectSpec(spec);
    return this;
  }

  populate(path, select) {
    if (typeof path === 'string') {
      this.populateSpecs.push({ path, select });
    } else if (path && typeof path === 'object') {
      this.populateSpecs.push(path);
    }
    return this;
  }

  lean() {
    this.options.lean = true;
    return this;
  }

  async exec() {
    const db = getPool();
    const { sql, params } = buildWhere(this.query, this.model);
    const order = toSqlOrder(this.sortSpec, this.model);
    const limit = this.limitCount ? ' LIMIT ?' : '';
    const offset = this.skipCount ? ' OFFSET ?' : '';
    const finalParams = params.slice();
    if (this.limitCount) finalParams.push(this.limitCount);
    if (this.skipCount) finalParams.push(this.skipCount);

    const selectedFields = getSelectedFields(this.model, this.selectSpec);
    const columns = selectedFields.length
      ? selectedFields.map(field => quoteIdentifier(assertSafeField(this.model, field))).join(', ')
      : '*';
    const [rows] = await db.query(`SELECT ${columns} FROM \`${this.model.table}\`${sql}${order}${limit}${offset}`, finalParams);
    const items = rows.map(row => this.options.lean ? inflateRow(row) : this.model.wrap(row));
    await populateItems(items, this.populateSpecs);
    if (this.options.single) return items[0] || null;
    return items;
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }
}

class SqlDocument {
  constructor(model, data = {}) {
    Object.defineProperty(this, '__model', { value: model, enumerable: false });
    Object.assign(this, data);
    this._id = this._id || createId();
  }

  async save() {
    const now = new Date();
    if (!this.createdAt) this.createdAt = now;
    this.updatedAt = now;
    await this.__model.upsert(this);
    return this;
  }

  async updateOne(updates) {
    await this.__model.applyUpdate({ _id: this._id }, updates);
    const fresh = await this.__model.findById(this._id);
    Object.assign(this, fresh || {});
    return { modifiedCount: fresh ? 1 : 0 };
  }

  toObject() {
    return { ...this };
  }

  toJSON() {
    return this.toObject();
  }
}

const createModel = ({ table, fields, DocumentClass = SqlDocument }) => {
  class Model extends DocumentClass {
    constructor(data = {}) {
      super(Model, data);
    }

    static get table() {
      return table;
    }

    static get fields() {
      return fields;
    }

    static wrap(row) {
      return row ? new Model(inflateRow(row)) : null;
    }

    static find(query = {}) {
      return new SqlQuery(Model, query);
    }

    static findOne(query = {}) {
      return new SqlQuery(Model, query, { single: true });
    }

    static findById(id) {
      return Model.findOne({ _id: id });
    }

    static async countDocuments(query = {}) {
      const db = getPool();
      const { sql, params } = buildWhere(query, Model);
      const [rows] = await db.query(`SELECT COUNT(*) AS count FROM \`${table}\`${sql}`, params);
      return Number(rows[0]?.count || 0);
    }

    static async create(data = {}) {
      const item = new Model(data);
      await item.save();
      return item;
    }

    static async upsert(item) {
      const db = getPool();
      const data = {};
      fields.forEach((field) => {
        if (field in item) data[field] = normalizeValue(field, item[field]);
      });
      if (!data._id) data._id = item._id || createId();
      const names = Object.keys(data);
      const updates = names.filter(name => name !== '_id').map(name => `\`${name}\`=VALUES(\`${name}\`)`).join(', ');
      await db.query(
        `INSERT INTO \`${table}\` (${names.map(name => `\`${name}\``).join(',')}) VALUES (${names.map(() => '?').join(',')}) ON DUPLICATE KEY UPDATE ${updates}`,
        names.map(name => data[name])
      );
      item._id = data._id;
    }

    static async applyUpdate(query, updates = {}) {
      const db = getPool();
      const setValues = {};
      if (updates.$set) Object.assign(setValues, updates.$set);
      if (updates.$inc) {
        const { sql, params } = buildWhere(query, Model);
        const incParts = Object.entries(updates.$inc).map(([field, amount]) => {
          const safeField = assertSafeField(Model, field);
          return `${quoteIdentifier(safeField)} = ${quoteIdentifier(safeField)} + ${Number(amount || 0)}`;
        });
        const [result] = await db.query(`UPDATE \`${table}\` SET ${incParts.join(', ')}, \`updatedAt\`=?${sql}`, [new Date(), ...params]);
        return { modifiedCount: result.affectedRows || 0 };
      }
      if (updates.$unset) {
        Object.keys(updates.$unset).forEach(field => {
          setValues[field] = null;
        });
      }
      if (!updates.$set && !updates.$unset && !updates.$inc) Object.assign(setValues, updates);
      setValues.updatedAt = new Date();

      const names = Object.keys(setValues);
      if (!names.length) return { modifiedCount: 0 };
      const { sql, params } = buildWhere(query, Model);
      const setParts = [];
      const setParams = [];

      names.forEach((name) => {
        assertSafeField(Model, name);
        const jsonParts = getJsonPathParts(name);
        if (jsonParts) {
          setParts.push(`${quoteIdentifier(jsonParts[0])}=JSON_SET(COALESCE(${quoteIdentifier(jsonParts[0])}, JSON_OBJECT()), '${toJsonPath(jsonParts)}', JSON_EXTRACT(?, '$'))`);
          setParams.push(JSON.stringify(setValues[name] === undefined ? null : setValues[name]));
          return;
        }

        setParts.push(`${quoteIdentifier(name)}=?`);
        setParams.push(normalizeValue(name, setValues[name]));
      });

      const [result] = await db.query(
        `UPDATE \`${table}\` SET ${setParts.join(', ')}${sql}`,
        [...setParams, ...params]
      );
      return { modifiedCount: result.affectedRows || 0 };
    }

    static async updateOne(query, updates) {
      return Model.applyUpdate(query, updates);
    }

    static async updateMany(query, updates) {
      return Model.applyUpdate(query, updates);
    }

    static async findByIdAndUpdate(id, updates, options = {}) {
      await Model.applyUpdate({ _id: id }, updates);
      return options.new ? Model.findById(id) : null;
    }

    static async findByIdAndDelete(id) {
      const item = await Model.findById(id);
      if (!item) return null;
      const db = getPool();
      await db.query(`DELETE FROM \`${table}\` WHERE \`_id\`=?`, [id]);
      return item;
    }
  }

  return Model;
};

module.exports = {
  createModel,
  SqlDocument
};
