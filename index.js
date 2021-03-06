const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const {
  connect, syncDb, buildAndRegisterModel, setupAssociations
} = require('./src/sequelize');
const { mapException, mapQueryParams } = require('./src/express');
const { genOpenApiJson, genSwaggerJson } = require('./src/swagger');
const app = express();

const sequelize = connect({
  database: "app",
  username: "user",
  password: "secret",
  host: "127.0.0.1",
  dialect: "postgres",
});
syncDb(sequelize);

const listResource = {
  name: 'List',
  path: '/lists',
  schema: {
    name: {
      type: 'string',
      allowNull: false,
      validate: {
        matches: ["^[a-z0-9 -_]+$",'i'],
        len: [3, 80],
      },
    },
  },
  associations: {
    hasMany: [{
      resource: 'Todo',
    }],
  },
  operations: ['get', 'post', 'put', 'patch', 'delete'],
};
const listModel = buildAndRegisterModel(listResource, sequelize);

const todoResource = {
  name: 'Todo',
  path: '/todos',
  schema: {
    title: {
      type: 'string',
      allowNull: false,
      validate: {
        len: [2, 500],
      },
    },
    completed: {
      type: 'boolean',
      allowNull: true,
    },
  },
  associations: {
    belongsTo: [{
      resource: 'List'
    }],
  },
  operations: ['get', 'post', 'put', 'patch', 'delete'],
};
const todoModel = buildAndRegisterModel(todoResource, sequelize);

setupAssociations([listResource, todoResource], sequelize);

app.use(bodyParser.json());
app.use('*', cors());
app.use(mapQueryParams);

app.resource(todoResource, sequelize);
app.resource(listResource, sequelize);

app.get('/openapi.json', (req, res) => res.send(genOpenApiJson([
  listResource, todoResource
])));

app.get('/swagger.json', (req, res) => res.send(genSwaggerJson([
  listResource, todoResource
])));

app.use(mapException);

app.listen(3000, () => {
  console.log('Example app listening on port 3000!');
});
