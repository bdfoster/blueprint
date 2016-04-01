var expect    = require ('chai').expect
  , blueprint = require ('../../lib')
  ;

describe ('index', function () {
  describe ('module.exports', function () {
    it ('should have keys for events', function () {
      var keys = [
        'Application',
        'ApplicationModule',
        'BaseController',
        'controller',
        'emit',
        'model',
        'on',
        'once',
        'destroy',
        'include'
      ];

      expect (blueprint).to.have.keys (keys);
    });
  });
});