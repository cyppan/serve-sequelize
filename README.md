# serve-sequelize

Safely and conveniently expose your sequelized data to API consumers with a declarative schema description of your resources

This library is mainly a wrapper around the following libraries:
- https://www.npmjs.com/package/sequelize
- https://www.npmjs.com/package/express
- https://www.npmjs.com/package/validate-data-tree



## Get started

```
$ mkdir api && cd api
$ npm init -y
$ npm install --save express sequelize serve-sequelize cors body-parser pg
$ docker run --name db -e POSTGRES_PASSWORD=secret -e POSTGRES_DB=app -e POSTGRES_USER=user -p 5432:5432 -d postgres
```

Let's create a simple TODO API with /todos and /lists containing todos
**index.js**
```js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const {
  connect, syncDb, buildAndRegisterModel, setupAssociations, mapException, mapQueryParams
} = require('serve-sequelize');

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
        is: ["^[a-zA-Z0-9]+$",'i'],
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

app.use(bodyParser.json())
app.use('*', cors({
  origin: (origin, callback) => callback(null, true)
}))
app.use(mapQueryParams)

app.resource(todoResource, sequelize)
app.resource(listResource, sequelize)

app.use(mapException)

app.listen(3000, () => {
  console.log('Example app listening on port 3000!')
})
```



### Play with your REST API (with the command line with the great https://httpie.org client)

#### Create, update and read TODOs

```
$ http POST localhost:3000/todos title="my todo"
HTTP/1.1 200 OK
Connection: keep-alive
Content-Length: 135
Content-Type: application/json; charset=utf-8
Date: Fri, 07 Dec 2018 12:55:54 GMT
ETag: W/"87-k869XB6Q6bzF740r5AyzYblRyWU"
Vary: Origin
X-Powered-By: Express

{
    "ListId": null,
    "completed": null,
    "createdAt": "2018-12-07T12:55:54.124Z",
    "id": 1,
    "title": "my todo",
    "updatedAt": "2018-12-07T12:55:54.124Z"
}

$ http localhost:3000/todos/1
HTTP/1.1 200 OK
...

{
    "ListId": null,
    "completed": null,
    "createdAt": "2018-12-07T12:55:54.124Z",
    "id": 1,
    "title": "my todo",
    "updatedAt": "2018-12-07T12:55:54.124Z"
}

$ http PATCH localhost:3000/todos/1 completed=true
HTTP/1.1 200 OK
...

{
    "ListId": null,
    "completed": true,
    "createdAt": "2018-12-07T12:55:54.124Z",
    "id": 1,
    "title": "my todo",
    "updatedAt": "2018-12-07T13:01:09.592Z"
}

$ http POST localhost:3000/todos title="another todo"
HTTP/1.1 200 OK
...

{
    "ListId": null,
    "completed": null,
    "createdAt": "2018-12-07T13:02:45.526Z",
    "id": 2,
    "title": "another todo",
    "updatedAt": "2018-12-07T13:02:45.526Z"
}

```

You can additionally pass a `params` query params which has to be a valid json like this:
```
{
  attributes: [field1, field2], // the fields you want to get back in the response
  where: {field1: "value"}, // sequelize DSL for filtering resources
  include: [{
    resource: 'AssociatedResourceName'
  }]
}
```



### Filtering

```
$ http GET 'localhost:3000/todos?params={"where":{"completed":true}}'
HTTP/1.1 200 OK
...

[
    {
        "ListId": null,
        "completed": true,
        "createdAt": "2018-12-07T12:55:54.124Z",
        "id": 1,
        "title": "my todo",
        "updatedAt": "2018-12-07T13:01:09.592Z"
    }
]
```



### Including associated resources

Let's create a list and associate our todos in it
```
$ http POST localhost:3000/lists name="my list"
HTTP/1.1 200 OK
...

{
    "createdAt": "2018-12-07T13:14:41.511Z",
    "id": 1,
    "name": "my list",
    "updatedAt": "2018-12-07T13:14:41.511Z"
}

$ http PATCH localhost:3000/todos/1 ListId=1
$ http PATCH localhost:3000/todos/2 ListId=1

$ http GET 'localhost:3000/lists/1?params={"include":[{"resource":"Todo"}]}'
HTTP/1.1 200 OK
...

{
    "Todos": [
        {
            "ListId": 1,
            "completed": true,
            "createdAt": "2018-12-07T12:55:54.124Z",
            "id": 1,
            "title": "my todo",
            "updatedAt": "2018-12-07T13:15:28.822Z"
        },
        {
            "ListId": 1,
            "completed": null,
            "createdAt": "2018-12-07T13:02:45.526Z",
            "id": 2,
            "title": "another todo",
            "updatedAt": "2018-12-07T13:15:52.424Z"
        }
    ],
    "createdAt": "2018-12-07T13:14:41.511Z",
    "id": 1,
    "name": "my list",
    "updatedAt": "2018-12-07T13:14:41.511Z"
}
```

Actually, the params handling is recursive, so you can trick your response like this:
```
$ http GET 'localhost:3000/lists/1?params={ "attributes": [ "name" ], "include": [{ "resource": "Todo", "attributes": [ "title","completed" ] } ] }'
HTTP/1.1 200 OK
...

{
    "Todos": [
        {
            "completed": true,
            "title": "my todo"
        },
        {
            "completed": null,
            "title": "another todo"
        }
    ],
    "name": "my list"
}

$ http GET 'localhost:3000/lists/1?params={ "attributes": [ "name" ], "include": [ {"resource": "Todo", "attributes": [ "title" ], "where": { "completed":true } } ] }'
HTTP/1.1 200 OK
...

{
    "Todos": [
        {
            "title": "my todo"
        }
    ],
    "name": "my list"
}
```



## Anatomy of a resource

...
