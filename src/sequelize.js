const Sequelize = require('sequelize');
const { validate } = require('validate-data-tree');
const { getIn } = require('immutable');
const { validateResource } = require('./resource');

const mapType = {
  string: Sequelize.STRING,
  text: Sequelize.TEXT,
  integer: Sequelize.INTEGER,
  bigint: Sequelize.BIGINT,
  float: Sequelize.FLOAT,
  double: Sequelize.DOUBLE,
  decimal: Sequelize.DECIMAL,
  date: Sequelize.DATE,
  boolean: Sequelize.BOOLEAN,
  object: Sequelize.JSONB,
  array: Sequelize.JSONB,
  enum: Sequelize.ENUM,
};

const buildModel = (resource) => {
  validateResource(resource);
  const modelSchema = {};
  const modelOptions = {
    hooks: resource.hooks,
  };
  Object.entries(resource.schema).forEach(([field, fieldSchema]) => {
    if (field === '$') {
      modelOptions.validate = fieldSchema.validate;
    } else {
      modelSchema[field] = Object.assign({}, fieldSchema);
      modelSchema[field].type = fieldSchema.sequelizeType || mapType[fieldSchema.type];
      delete modelSchema[field].schema;
      delete modelSchema[field].sequelizeType;
      if (modelSchema[field].type === Sequelize.JSONB && fieldSchema.schema) {
        modelSchema[field].validate = modelSchema[field].validate || {};
        modelSchema[field].validate.nestedSchema = o => validate(
          { [field]: o },
          { [field]: fieldSchema },
          [],
        );
      }
    }
  });
  return [modelSchema, modelOptions];
};

const buildAndRegisterModel = (resource, sequelize) => {
  const [modelSchema, modelOptions] = buildModel(resource);
  return sequelize.define(resource.name, modelSchema, modelOptions);
};

const setupAssociations = (resources, { models }) => {
  resources.forEach((resource) => {
    const Model = models[resource.name];
    getIn(resource, ['associations', 'belongsTo'], []).forEach(({ resource: assocResource, ...spec }) => {
      const refModel = models[assocResource];
      Model.belongsTo(refModel, spec);
    });
    getIn(resource, ['associations', 'hasMany'], []).forEach(({ resource: assocResource, ...spec }) => {
      const refModel = models[assocResource];
      Model.hasMany(refModel, spec);
    });
    getIn(resource, ['associations', 'hasOne'], []).forEach(({ resource: assocResource, ...spec }) => {
      const refModel = models[assocResource];
      Model.hasOne(refModel, spec);
    });
    getIn(resource, ['associations', 'belongsToMany'], []).forEach(({ resource: assocResource, ...spec }) => {
      const refModel = models[assocResource];
      Model.belongsToMany(refModel, spec);
    });
  });
};

const syncDb = (sequelize, insertFixturesFn) => sequelize
  .authenticate()
  .then(() => {
    console.log('Connection has been established successfully.');
    console.log('Now forcing DB schema sync');
    return sequelize.sync({ force: true });
  })
  .then(() => {
    if (insertFixturesFn) {
      console.log('inserting fixtures');
      return insertFixturesFn();
    }
    return null;
  })
  .catch((err) => {
    console.error('Unable to connect to the database:', err);
  });

const connect = (config) => {
  const { Op } = Sequelize;
  const operatorsAliases = {
    $eq: Op.eq,
    $ne: Op.ne,
    $gte: Op.gte,
    $gt: Op.gt,
    $lte: Op.lte,
    $lt: Op.lt,
    $not: Op.not,
    $in: Op.in,
    $notIn: Op.notIn,
    $is: Op.is,
    $like: Op.like,
    $notLike: Op.notLike,
    $iLike: Op.iLike,
    $notILike: Op.notILike,
    $regexp: Op.regexp,
    $notRegexp: Op.notRegexp,
    $iRegexp: Op.iRegexp,
    $notIRegexp: Op.notIRegexp,
    $between: Op.between,
    $notBetween: Op.notBetween,
    $overlap: Op.overlap,
    $contains: Op.contains,
    $contained: Op.contained,
    $adjacent: Op.adjacent,
    $strictLeft: Op.strictLeft,
    $strictRight: Op.strictRight,
    $noExtendRight: Op.noExtendRight,
    $noExtendLeft: Op.noExtendLeft,
    $and: Op.and,
    $or: Op.or,
    $any: Op.any,
    $all: Op.all,
    $values: Op.values,
    $col: Op.col,
  };

  const {
    database, username, password, ...options
  } = config;
  return new Sequelize(database, username, password, {
    ...options,
    operatorsAliases,
  });
};

module.exports = {
  buildModel,
  buildAndRegisterModel,
  setupAssociations,
  syncDb,
  connect,
};
