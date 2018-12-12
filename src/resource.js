const { validate, ValidationErrorItem } = require('validate-data-tree');
const assert = require('assert');

const associationsSchema = {
  type: 'array',
  allowNull: true,
  schema: {
    resource: {
      type: 'string',
      validate: {
        matches: '^[A-Za-z]+$',
      },
    },
  },
};

const validateField = (field, prefix = []) => {
  validate(field, {
    type: {
      type: 'string',
      allowNull: true,
      validate: {
        isIn: [[
          'string', 'text', 'integer', 'bigint', 'float', 'double',
          'decimal', 'date', 'boolean', 'object', 'array', 'enum',
        ]],
      },
    },
    allowNull: {
      type: 'boolean',
      allowNull: true,
    },
    validate: {
      type: 'object',
      allowNull: true,
    },
    schema: {
      type: 'object',
      allowNull: true,
      validate: {
        fields: (o) => {
          Object.entries(o).forEach(([k, v]) => {
            validateField(v, [...prefix, 'schema', k]);
          });
          return true;
        },
      },
    },
  }, prefix);
};

const schema = {
  name: {
    type: 'string',
    validate: {
      matches: '^[A-Za-z]+$',
    },
  },
  path: {
    type: 'string',
    validate: {
      matches: "^(/[A-Za-z0-9-._~!$%'()*+,;=:@]*)+[^/]$",
      // https://stackoverflow.com/questions/4669692/valid-characters-for-directory-part-of-a-url-for-short-links
    },
  },
  associations: {
    type: 'object',
    allowNull: true,
    schema: {
      hasMany: associationsSchema,
      hasOne: associationsSchema,
      belongsTo: associationsSchema,
      belongsToMany: associationsSchema,
    },
  },
  operations: {
    type: 'array',
    schema: {
      $: {
        validate: {
          isString: true,
          isIn: [['get', 'post', 'put', 'patch', 'delete']],
        },
      },
    },
  },
  attributes: {
    type: 'object',
    schema: {
      include: {
        type: 'array',
        schema: {
          $: {
            type: 'string',
          },
        },
      },
      exclude: {
        type: 'array',
        schema: {
          $: {
            type: 'string',
          },
        },
      },
    },
  },
  views: {
    type: 'object',
    allowNull: true,
    validate: {
      custom: (o) => {
        Object.entries(o).forEach(([k, v]) => {
          if (!new RegExp('^[A-Za-z]+$').test(k)) {
            throw new ValidationErrorItem(
              'wrong view identifier',
              'Validation Error',
              ['views'],
              k,
              null,
              'viewName',
              'viewName',
              null,
            );
          }
          validate(v, {
            path: {
              type: 'string',
              validate: {
                matches: "^(/[A-Za-z0-9-._~!$%'()*+,;=:@]*)+[^/]$",
                // https://stackoverflow.com/questions/4669692/valid-characters-for-directory-part-of-a-url-for-short-links
              },
            },
            attributes: {
              types: 'array',
              allowNull: true,
              schema: {
                $: {
                  type: 'string',
                },
              },
            },
          }, ['views', k]);
        });
        return true;
      },
    },
  },
  schema: {
    type: 'object',
    allowNull: false,
    validate: {
      fields: (o) => {
        Object.entries(o).forEach(([k, v]) => {
          validateField(v, ['schema', k]);
        });
        return Object.keys(o).length > 0;
      },
    },
  },
  $: {
    validate: {
      allowedKeys: [
        'name', 'path', 'associations', 'operations', 'schema', 'views',
        'attributes', 'authorize', 'hooks',
      ],
    },
  },
};

const validateResource = (resource) => {
  assert(resource, "resource shouldn't be empty");
  validate(resource, schema);
};

module.exports = {
  validateResource,
};
