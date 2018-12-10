/* eslint-disable no-unused-vars, import/no-unresolved */
const express = require('express');
const { ValidationError, ValidationErrorItem, ForeignKeyConstraintError } = require('sequelize');
const { mapKeyToPath, ValidationErrors } = require('validate-data-tree');
const { Set, getIn } = require('immutable');
const asyncHandler = require('express-async-handler');
const { validateResource } = require('./resource');

const mapException = (err, req, res, _) => {
  const flatMap = (xs, f) => xs.reduce((acc, x) => acc.concat(f(x)), []);

  const mapValidationErrors = errs => flatMap(errs, error => (
    (error instanceof ValidationErrors) ? error.errors : [error]
  )).map(({
    message, path, value, validatorKey, validatorName, validatorArgs,
  }) => ({
    message,
    path: path && mapKeyToPath(path),
    value,
    validatorKey,
    validatorName,
    validatorArgs,
  }));

  if (err instanceof ValidationError) {
    res.status(422).json(mapValidationErrors(err.errors));
  } else if (err instanceof ForeignKeyConstraintError) {
    res.status(422).json([{
      message: err.message,
      path: [],
    }]);
  } else {
    console.error(err);
    res.sendStatus(500);
  }
};

const mapQueryParams = (req, res, next) => {
  if (req.query.params) {
    try {
      req.query.params = JSON.parse(req.query.params);
      next();
    } catch (e) {
      res.status(400).json([{ message: "invalid Json found at query string 'params'" }]);
    }
  } else {
    next();
  }
};

express.application.resource = function (Resource, sequelize) {
  validateResource(Resource);
  const app = this;

  app.resourcesRegistry = app.resourcesRegistry || {};
  app.viewsRegistry = app.viewsRegistry || {};

  app.resourcesRegistry[Resource.name] = Resource;

  const Model = sequelize.models[Resource.name];
  const {
    path, operations = [], views = {},
  } = Resource;

  const mapAttributes = (attributes, resourceKey) => {
    const resource = resourceKey ? app.resourcesRegistry[resourceKey] : Resource;
    const allowedAttributes = Object.keys(resource.schema)
      .concat(['id', 'createdAt', 'updatedAt'])
      // TODO stronger inclusion of foreign keys
      .concat(getIn(resource, ['associations', 'belongsTo'], []).map(spec => `${spec.resource}Id`))
      .filter(k => k !== '$')
      // TODO support include too
      .filter(k => !getIn(resource, ['authorize', 'filterAttributes', 'exclude'])
        || !resource.authorize.filterAttributes.exclude.includes(k));
    return ((!attributes || !attributes.length) && allowedAttributes)
      || Set(attributes).intersect(allowedAttributes).toJS();
  };

  const mapWhere = (req, where, resourceKey) => {
    const resource = resourceKey ? app.resourcesRegistry[resourceKey] : Resource;
    const filterWhere = getIn(resource, ['authorize', 'filterWhere']);
    if (!filterWhere) return where;
    return where ? {
      $and: [filterWhere(req), where],
    } : filterWhere(req);
  };

  const mapInclude = (req, resourceInclude, resourceKey) => {
    const resource = resourceKey ? app.resourcesRegistry[resourceKey] : Resource;
    return resourceInclude && resourceInclude.map(({
      resource: includeResource, view, where, attributes, include,
    }) => {
      const viewResource = view && app.viewsRegistry[view];
      const hasResourceAssociation = [
        ...getIn(resource, ['associations', 'belongsTo'], []),
        ...getIn(resource, ['associations', 'hasMany'], []),
        ...getIn(resource, ['associations', 'hasOne'], []),
        ...getIn(resource, ['associations', 'belongsToMany'], []),
      ].find(assoc => assoc.resource === (includeResource || (viewResource && viewResource.name)));
      if (hasResourceAssociation) {
        if (includeResource) {
          return {
            model: sequelize.models[includeResource],
            where: mapWhere(req, where, includeResource),
            attributes: mapAttributes(attributes, includeResource),
            include: include ? mapInclude(req, include, includeResource) : [],
            required: false,
          };
        } if (viewResource) {
          return {
            model: sequelize.models[viewResource.name],
            attributes: viewResource.views[view].attributes,
            required: false,
          };
        }
        return null;
      }
      return null;
    }).filter(include => include && include.model);
  };

  if (operations.includes('get')) {
    app.get(path, asyncHandler(async (req, res) => {
      const docs = await Model.findAll({
        attributes: mapAttributes(getIn(req.query, ['params', 'attributes'])),
        where: mapWhere(req, getIn(req.query, ['params', 'where'])),
        include: mapInclude(req, getIn(req.query, ['params', 'include'])),
      });
      res.json(docs);
    }));

    app.get(`${path}/:id(\\d+)/`, asyncHandler(async (req, res) => {
      const doc = await Model.findOne({
        attributes: mapAttributes(getIn(req.query, ['params', 'attributes'])),
        where: mapWhere(req, { id: req.params.id }),
        include: mapInclude(req, getIn(req.query, ['params', 'include'])),
      });
      if (doc) {
        res.json(doc);
      } else {
        res.sendStatus(404);
      }
    }));
  }

  Object.entries(views).forEach(([viewName, { path: viewPath, attributes }]) => {
    app.viewsRegistry[viewName] = Resource;
    app.get(viewPath, asyncHandler(async (req, res) => {
      const docs = await Model.findAll({
        attributes,
      });
      res.json(docs);
    }));
  });

  if (operations.includes('post')) {
    app.post(path, asyncHandler(async (req, res) => {
      const beforeCreate = getIn(Resource, ['authorize', 'beforeCreate']);
      if (beforeCreate) {
        beforeCreate(req);
      }
      const authValidate = getIn(Resource, ['authorize', 'validate']);
      if (authValidate && !authValidate(req)(req.body)) {
        throw new ValidationError(null, [
          new ValidationErrorItem('authorize validation failed', 'forbidden', '$', req.body),
        ]);
      }
      let doc = await Model.create(req.body);
      doc = await Model.findOne({
        attributes: mapAttributes(),
        where: mapWhere(req, { id: doc.id }),
      });
      res.send(doc);
    }));
  }

  if (operations.includes('put')) {
    app.put(`${path}/:id(\\d+)/`, asyncHandler(async (req, res) => {
      const model = await Model.findByPk(req.params.id);
      model.set(req.body);
      await model.save();
      const doc = await Model.findOne({
        attributes: mapAttributes(),
        where: mapWhere(req, { id: req.params.id }),
      });
      res.send(doc);
    }));
  }

  if (operations.includes('patch')) {
    app.patch(`${path}/:id(\\d+)/`, asyncHandler(async (req, res) => {
      const model = await Model.findByPk(req.params.id);
      await model.update(req.body);
      const doc = await Model.findOne({
        attributes: mapAttributes(),
        where: mapWhere(req, { id: req.params.id }),
      });
      res.send(doc);
    }));
  }

  if (operations.includes('delete')) {
    app.delete(`${path}/:id(\\d+)/`, asyncHandler(async (req, res) => {
      const model = await Model.findByPk(req.params.id);
      await model.destroy();
      res.sendStatus(204);
    }));
  }
};

module.exports = {
  mapException,
  mapQueryParams,
};
