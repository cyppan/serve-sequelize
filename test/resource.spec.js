const assert = require('assert');
const { validateResource } = require('../src/resource');

describe('validateResource', () => {
  it('should fail for empty resource', () => {
    assert.throws(
      () => {
        validateResource(null);
      }, {
        name: 'AssertionError [ERR_ASSERTION]',
        message: "resource shouldn't be empty",
      },
    );
  });

  it('should fail for invalid resource', () => {
    assert.throws(
      () => {
        validateResource({
          name: 'invalid name',
          path: 'invalid path',
          operations: ['get', 'UNKNOWN'],
          views: 'wrong type',
          extraKey: null,
        });
      }, (errs) => {
        assert.equal(errs.errors.length, 6);
        assert.equal(errs.errors[0].path, 'name');
        assert.equal(errs.errors[0].validatorName, 'matches');
        assert.equal(errs.errors[1].path, 'path');
        assert.equal(errs.errors[1].validatorName, 'matches');
        assert.equal(errs.errors[2].path, 'views');
        assert.equal(errs.errors[2].validatorName, 'type');
        assert.equal(errs.errors[3].path, 'schema');
        assert.equal(errs.errors[3].validatorName, 'required');
        assert.equal(errs.errors[4].path, '$');
        assert.equal(errs.errors[4].validatorName, 'allowedKeys');
        assert.equal(errs.errors[5].path, 'operations.1');
        assert.equal(errs.errors[5].validatorName, 'isIn');
        return true;
      },
    );
  });
});
