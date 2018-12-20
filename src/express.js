/* eslint-disable no-unused-vars, import/no-unresolved */
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

  if (err instanceof ValidationError && Array.isArray(err.errors) && err.errors.length && err.errors[0].message instanceof ValidationErrors) {
    res.status(422).json(mapValidationErrors(err.errors[0].message.errors));
  } else if (err instanceof ValidationError) {
    res.status(422).json(
      mapValidationErrors(
        flatMap(err.errors, e =>
          e.message instanceof ValidationErrors ? e.message.errors : [e]
        )
      )
    );
  } else if (err instanceof ForeignKeyConstraintError) {
    res.status(422).json([{
      message: err.message,
      path: [],
    }]);
  } else if (err instanceof SyntaxError) {
    res.status(400).json([{
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

const parseIntQueryParam = (req, key) => {
  if (req.query && req.query[key]) {
    const n = parseInt(req.query[key]);
    return !Number.isNaN(n) && n;
  }
  return null;
};

const MaxPageLimit = 100;
const DefaultPageLimit = 100;

const extendExpress = (express) => {
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

    const mapAttributes = (resourceKey, viewAttributes = null, userAttributes = null) => {
      const resource = resourceKey ? app.resourcesRegistry[resourceKey] : Resource;
      return Object.keys(resource.schema)
        .concat(['id', 'createdAt', 'updatedAt'])
        // TODO stronger inclusion of foreign keys
        .concat(getIn(resource, ['associations', 'belongsTo'], []).map(spec => `${spec.resource}Id`))
        .filter(k => !getIn(resource, ['attributes', 'include'])
          || resource.attributes.include.includes(k))
        .filter(k => !viewAttributes || !viewAttributes.include
          || viewAttributes.include.includes(k))
        .filter(k => !userAttributes || !userAttributes.include
          || userAttributes.include.includes(k))
        .filter(k => k !== '$')
        .filter(k => !getIn(resource, ['attributes', 'exclude'])
          || !resource.attributes.exclude.includes(k))
        .filter(k => !viewAttributes || !viewAttributes.exclude
          || !viewAttributes.exclude.includes(k))
        .filter(k => !userAttributes || !userAttributes.exclude
          || !userAttributes.exclude.includes(k));
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
        resource: includeResource, view, where, attributes, include, required,
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
              attributes: mapAttributes(includeResource, null, attributes),
              include: include ? mapInclude(req, include, includeResource) : [],
              required: required || false,
            };
          }
          if (viewResource) {
            const { attributes: viewAttributes, buildWhere, include: viewInclude } = viewResource.views[view];
            return {
              model: sequelize.models[viewResource.name],
              ...(buildWhere && { where: buildWhere(req) }),
              attributes: mapAttributes(viewResource.name, viewAttributes, attributes),
              include: viewInclude ? mapInclude(req, viewInclude, viewResource.name) : [],
              required: required || false,
            };
          }
          return null;
        }
        return null;
      }).filter(include => include && include.model);
    };

    const mapOrder = orderParam => orderParam && orderParam.split(',').map(
      p => p.startsWith('-') ? [p.slice(1), 'DESC'] : [p, 'ASC']
    );

    if (operations.includes('get')) {
      app.get(path, asyncHandler(async (req, res) => {
        const limitParam = parseIntQueryParam(req, 'limit');
        const docs = await Model.findAndCountAll({
          attributes: mapAttributes(null, null, getIn(req.query, ['params', 'attributes'])),
          where: mapWhere(req, getIn(req.query, ['params', 'where'])),
          include: mapInclude(req, getIn(req.query, ['params', 'include'])),
          // raw: true,
          offset: parseIntQueryParam(req, 'offset') || 0,
          limit: (limitParam && limitParam > MaxPageLimit && MaxPageLimit)
            || limitParam
            || DefaultPageLimit,
          order: mapOrder(req.query.order) || Resource.order,
        });
        res.json(docs);
      }));

      app.get(`${path}/:id(\\d+)/`, asyncHandler(async (req, res) => {
        const doc = await Model.findOne({
          attributes: mapAttributes(null, null, getIn(req.query, ['params', 'attributes'])),
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

    // Building views
    Object.entries(views).forEach(([viewName, { path: viewPath, attributes, buildWhere, include, order }]) => {
      app.viewsRegistry[viewName] = Resource;
      app.get(viewPath, asyncHandler(async (req, res) => {
        const limitParam = parseIntQueryParam(req, 'limit');
        const docs = await Model.findAndCountAll({
          attributes: mapAttributes(Resource.name, attributes, getIn(req.query, ['params', 'attributes'])),
          ...(buildWhere && { where: buildWhere(req) }),
          include: mapInclude(req, include),
          offset: parseIntQueryParam(req, 'offset') || 0,
          limit: (limitParam && limitParam > MaxPageLimit && MaxPageLimit)
            || limitParam
            || DefaultPageLimit,
          order: mapOrder(req.query.order) || order,
        });
        res.json(docs);
      }));
      app.get(`${viewPath}/:id(\\d+)/`, asyncHandler(async (req, res) => {
        const doc = await Model.findOne({
          attributes: mapAttributes(Resource.name, attributes, getIn(req.query, ['params', 'attributes'])),
          where: {
            id: req.params.id,
            ...(buildWhere && buildWhere(req)),
          },
          include: mapInclude(req, include),
        });
        if (doc) {
          res.json(doc);
        } else {
          res.sendStatus(404);
        }
      }));
    });

    if (operations.includes('post')) {
      app.post(path, asyncHandler(async (req, res) => {
        const beforeCreate = getIn(Resource, ['authorize', 'beforeCreate']);
        if (beforeCreate) {
          beforeCreate(req);
        }
        const authValidate = getIn(Resource, ['authorize', 'validate']);
        if (authValidate && !authValidate(req)) {
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
        const model = await Model.findOne({ where: mapWhere(req, { id: req.params.id }) });
        if (model) {
          const authValidate = getIn(Resource, ['authorize', 'validate']);
          if (authValidate && !authValidate(req, model)) {
            throw new ValidationError(null, [
              new ValidationErrorItem('authorize validation failed', 'forbidden', '$', req.body),
            ]);
          }
          model.set(req.body);
          await model.save();
          const doc = await Model.findOne({
            attributes: mapAttributes(),
            where: mapWhere(req, { id: req.params.id }),
          });
          res.send(doc);
        } else {
          res.sendStatus(404);
        }
      }));
    }

    if (operations.includes('patch')) {
      app.patch(`${path}/:id(\\d+)/`, asyncHandler(async (req, res) => {
        const model = await Model.findOne({ where: mapWhere(req, { id: req.params.id}) });
        if (model) {
          const authValidate = getIn(Resource, ['authorize', 'validate']);
          if (authValidate && !authValidate(req, model)) {
            throw new ValidationError(null, [
              new ValidationErrorItem('authorize validation failed', 'forbidden', '$', req.body),
            ]);
          }
          await model.update(req.body);
          const doc = await Model.findOne({
            attributes: mapAttributes(),
            where: mapWhere(req, { id: req.params.id }),
          });
          res.send(doc);
        } else {
          res.sendStatus(404);
        }
      }));
    }

    if (operations.includes('delete')) {
      app.delete(`${path}/:id(\\d+)/`, asyncHandler(async (req, res) => {
        const model = await Model.findOne({ where: mapWhere(req, { id: req.params.id }) });
        if (model) {
          await model.destroy();
          res.sendStatus(204);
        } else {
          res.sendStatus(404);
        }
      }));
    }
  };
};

module.exports = {
  mapException,
  mapQueryParams,
  extendExpress,
};
