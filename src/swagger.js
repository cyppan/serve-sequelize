// to be exposed as openapi.json

const spec = {
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'Koba API',
  },
  servers: [
    {
      url: 'https://campaign-api.koba-civique.com',
    },
  ],
};

const swaggerSpec = {
  swagger: '2.0',
  info: {
    version: '1.0.0',
    title: 'Koba API',
  },
  host: 'campaign-api.koba-civique.com',
  basePath: '/',
  schemes: [
    'http',
  ],
  consumes: [
    'application/json',
  ],
  produces: [
    'application/json',
  ],
};

const genOpenApiJson = (resources = []) => {
  const paths = {};
  resources.forEach(({
    name, pluralizedName, path, operations,
  }) => {
    const plural = pluralizedName || `${name}s`;
    paths[path] = {};
    paths[`${path}/{${name}Id}`] = {};
    if (operations.includes('get')) {
      paths[path].get = {
        summary: `List all ${name}`,
        operationId: `list${name}`,
        tags: [name.toLowerCase()],
        parameters: [{
          name: 'params',
          in: 'query',
          description: 'json serialized fetch spec',
          required: false,
          schema: {
            type: 'any',
          },
        }],
        responses: {
          200: {
            description: `an array of ${plural}`,
            content: {
              'application/json': {
                schema: {
                  $ref: `#/components/schemas/${plural}`,
                },
              },
            },
          },
        },
      };
      paths[`${path}/{${name}Id}`].get = {
        summary: `Get ${name} by id`,
        operationId: `show${name}ById`,
        tags: [name.toLowerCase()],
        parameters: [{
          name: `${name}Id`,
          in: 'path',
          required: true,
          description: `the is of the ${name.toLowerCase()} to retrieve`,
          schema: {
            type: 'integer',
          },
        }],
        responses: {
          200: {
            description: `the ${name}`,
            content: {
              'application/json': {
                schema: {
                  $ref: `#/components/schemas/${name}`,
                },
              },
            },
          },
        },
      };
    }
  });

  const components = {};
  resources.forEach(({ name, pluralizedName, schema }) => {
    components[name] = {
      required: Object.entries(schema).filter(([, v]) => !v.allowNull).map(([k]) => k),
      properties: Object.entries(schema).map(
        ([k, { type }]) => [k, { type }],
      ).reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
    };
    components[pluralizedName || `${name}s`] = {
      type: 'array',
      items: {
        $ref: `#/components/schemas/${name}`,
      },
    };
  });

  return {
    ...spec,
    paths,
    components: {
      schemas: components,
    },
  };
};

const genSwaggerJson = (resources = []) => {
  const paths = {};
  resources.forEach(({
    name, pluralizedName, path, operations,
  }) => {
    const plural = pluralizedName || `${name}s`;
    paths[path] = {};
    paths[`${path}/{${name}Id}`] = {};
    if (operations.includes('get')) {
      paths[path].get = {
        summary: `List all ${name}`,
        operationId: `list${name}`,
        tags: [name.toLowerCase()],
        parameters: [{
          name: 'params',
          in: 'query',
          description: 'json serialized fetch spec',
          required: false,
          type: 'any',
        }],
        responses: {
          200: {
            description: `an array of ${plural}`,
            schema: {
              $ref: `#/definitions/${plural}`,
            },
          },
        },
      };
      paths[`${path}/{${name}Id}`].get = {
        summary: `Get ${name} by id`,
        operationId: `show${name}ById`,
        tags: [name.toLowerCase()],
        parameters: [{
          name: `${name}Id`,
          in: 'path',
          required: true,
          description: `the is of the ${name.toLowerCase()} to retrieve`,
          type: 'integer',
        }],
        responses: {
          200: {
            description: `the ${name}`,
            schema: {
              $ref: `#/definitions/${name}`,
            },
          },
        },
      };
    }
  });

  const definitions = {};
  resources.forEach(({ name, pluralizedName, schema }) => {
    definitions[name] = {
      required: Object.entries(schema).filter(([, v]) => !v.allowNull).map(([k]) => k),
      properties: Object.entries(schema).map(
        ([k, { type }]) => [k, { type }],
      ).reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
    };
    definitions[pluralizedName || `${name}s`] = {
      type: 'array',
      items: {
        $ref: `#/definitions/${name}`,
      },
    };
  });

  return {
    ...swaggerSpec,
    paths,
    definitions,
  };
};


module.exports = {
  genOpenApiJson,
  genSwaggerJson,
};
