var util  = require ('util')
  , async = require ('async')
  , _     = require ('underscore')
  ;

var BaseController = require ('./BaseController')
  , HttpError      = require ('./errors/HttpError')
  ;

/**
 * Test if the projection is exclusive. An exclusive projection only has to
 * have one key that is false (or 0). Any empty projection is exclusive as well,
 * meaning that all fields will be included.
 *
 * @param projection
 * @returns {*}
 */
function isProjectionExclusive (projection) {
  var keys = Object.keys (projection);

  if (keys.length === 0)
    return true;

  var value = projection[keys[0]];
  return value === false || value === 0;
}

function __onAuthorize (req, callback) { return callback (null); }
function __onPrepareProjection (req, callback) { return callback (null, {}); }
function __onPrepareOptions (req, callback) { return callback (null, {}); }
function __onUpdateFilter (req, filter, callback) { return callback (null, filter); }
function __onPreCreate (req, doc, callback) {
  return callback (null, doc);
}
function __onPostExecute (req, result, callback) { return callback (null, result); }

function checkIdThenAuthorize (id, next) {
  return function __blueprint_checkIdThenAuthorize (req, callback) {
    if (!req.params[id])
      return callback (new HttpError (400, 'Missing resource id'));

    return next (req, callback);
  }
}
/**
 * Make the database completion handler. We have to create a new handler
 * for each execution because we need to bind to a different callback.
 *
 * @param res
 * @returns {Function}
 */
function makeDbCompletionHandler (callback) {
  return function __blueprint_db_execution_complete (err, result) {
    if (err) return callback (new HttpError (400, 'Failed to get resource'));
    if (!result) return callback (new HttpError (404, 'Not Found'));

    return callback (null, result);
  }
}

/**
 * Make the handler that executes after the async.waterfall tasks is complete. We
 * cannot reuse the same method since we have to bind to a different res object
 * for each request.
 *
 * @param res
 * @returns {Function}
 */
function makeTaskCompletionHandler (res, callback) {
  return function __blueprint_task_complete (err, result) {
    if (err) return callback (err);

    res.status (200).json (result);
    return callback ();
  }
}

function makeOnPreCreateHandler (req, onPreCreate) {
  return function __blueprint_on_prepare_document (doc, callback) {
    return onPreCreate (req, doc, callback);
  };
}

/**
 * @class ResourceController
 *
 * Base class f or all resource controllers.
 *
 * @param opts
 * @constructor
 */
function ResourceController (opts) {
  BaseController.call (this);

  opts = opts || {};

  if (!opts.model)
    throw new Error ('Options must define model property');

  if (!opts.name)
    throw new Error ('Options must define name property');

  this._id = opts.id;
  this._model = opts.model;
  this._name = opts.name;

  if (!this._id)
    this._id = this._name + 'Id';
}

util.inherits (ResourceController, BaseController);

/**
 * Get the resource identifier.
 */
ResourceController.prototype.__defineGetter__ ('resourceId', function () {
  return this._id;
});

/**
 * Get a list of the resources, if not all.
 *
 * @param opts
 * @returns
 */
ResourceController.prototype.getAll = function (opts) {
  opts = opts || {};
  var on = opts.on || {};

  var onUpdateFilter = on.updateFilter || __onUpdateFilter;
  var onPostExecute = on.postExecute || __onPostExecute;
  var onAuthorize = on.authorize || __onAuthorize;
  var onPrepareProjection = on.prepareProjection || __onPrepareProjection;
  var onPrepareOptions = on.prepareOptions || __onPrepareOptions;

  var self = this;

  return {
    // There is no resource id that needs to be validated. So, we can
    // just pass control to the onAuthorize method.
    validate: function (req, callback) {
      async.series ([
        // First, validate the query string.
        function (callback) {
          req.checkQuery ('options', 'Invalid options').optional ().isJSON ();

          return callback (req.validationErrors (true));
        },

        function (callback) {
          onAuthorize (req, callback);
        }
      ], callback);
    },

    sanitize: function (req, callback) {
      if (req.query.options)
        req.query.options = JSON.parse (req.query.options);

      return callback (null);
    },

    execute: function __blueprint_getall_execute (req, res, callback) {
      async.waterfall ([
        async.constant (_.omit (req.query, ['options'])),

        function (filter, callback) {
          return onUpdateFilter (req, filter, callback)
        },

        // Now, let's search our database for the resource in question.
        function (filter, callback) {
          onPrepareOptions (req, function (err, options) {
            if (err) return callback (err);
            options = options || {};

            // Update the options with those from the query string.
            var opts = req.query.options || {};

            if (opts.skip)
              options['skip'] = opts.skip;

            if (opts.limit)
              options['limit'] = opts.limit;

            if (opts.sort)
              options['sort'] = opts.sort;

            onPrepareProjection (req, function (err, projection) {
              if (err) return callback (err);

              // Do not include the version field in the projection.
              if (isProjectionExclusive (projection))
                projection['__v'] = 0;

              self._model.find (filter, projection, options, makeDbCompletionHandler (callback));
            });
          });
        },

        // Allow the subclass to do any post-execution analysis of the result.
        function (result, callback) { onPostExecute (req, result, callback); },

        // Rewrite the result in JSON API format.
        function (data, callback) {
          var pluralName = self._name + 's';

          var result = { };
          result[pluralName] = data;

          return callback (null, result);
        }
      ], makeTaskCompletionHandler (res, callback));
    }
  };
};

/**
 * Create a new resource.
 *
 * @param opts
 * @returns
 */
ResourceController.prototype.create = function (opts) {
  opts = opts || {};
  var on = opts.on || {};

  var onPreCreate = on.preCreate || __onPreCreate;
  var onPostExecute = on.postExecute || __onPostExecute;
  var onAuthorize = on.authorize || __onAuthorize;

  var self = this;

  return {
    // There is no resource id that needs to be validated. So, we can
    // just pass control to the onAuthorize method.
    validate: onAuthorize,

    execute: function __blueprint_create (req, res, callback) {
      var doc = req.body[self._name];

      async.waterfall ([
        async.constant (doc),
        makeOnPreCreateHandler (req, onPreCreate),

        // Now, let's search our database for the resource in question.
        function (doc, callback) {
          self._model.create (doc, makeDbCompletionHandler (callback));
        },

        // Allow the subclass to do any post-execution analysis of the result.
        function (result, callback) { onPostExecute (req, result, callback); },

        // Serialize the data in REST format.
        function (data, callback) {
          var result = {};

          data = data.toJSON ? data.toJSON () : (data.toObject ? data.toObject () : data);
          result[self._name] = _.omit (data, '__v');

          return callback (null, result);
        }
      ], makeTaskCompletionHandler (res, callback));
    }
  }
};

/**
 * Get a single resource.
 *
 * @param opts
 * @returns
 */
ResourceController.prototype.get = function (opts) {
  opts = opts || {};
  var on = opts.on || {};

  var onUpdateFilter = on.updateFilter || __onUpdateFilter;
  var onPostExecute = on.postExecute || __onPostExecute;
  var onAuthorize = on.authorize || __onAuthorize;
  var onPrepareProjection = on.prepareProjection || __onPrepareProjection;

  var self = this;

  return {
    validate: checkIdThenAuthorize (self._id, onAuthorize),

    execute: function __blueprint_get_execute (req, res, callback) {
      var rcId = req.params[self._id];
      var filter = {_id: rcId};

      async.waterfall ([
        // First, allow the subclass to update the filter.
        async.constant (filter),
        function (filter, callback) {
          return onUpdateFilter (req, filter, callback)
        },

        // Prepare the projection, and then execute the database command.
        function (filter, callback) {
          onPrepareProjection (req, function (err, projection) {
            // Do not include the version field in the projection.
            if (isProjectionExclusive (projection) && projection['__v'] === undefined)
              projection['__v'] = 0;

            self._model.findOne (filter, projection, makeDbCompletionHandler (callback));
          });
        },

        // Allow the subclass to do any post-execution analysis of the result.
        function (result, callback) { onPostExecute (req, result, callback); },

        // Rewrite the result in JSON API format.
        function (data, callback) {
          var result = { };
          result[self._name] = data;

          return callback (null, result);
        }
      ], makeTaskCompletionHandler (res, callback));
    }
  };
};

/**
 * Update a single resource.
 *
 * @param opts
 * @returns
 */
ResourceController.prototype.update = function (opts) {
  opts = opts || {};
  var on = opts.on || {};

  var onUpdateFilter = on.updateFilter || __onUpdateFilter;
  var onPostExecute = on.postExecute || __onPostExecute;
  var onAuthorize = on.authorize || __onAuthorize;
  var onPrepareProjection = on.prepareProjection || __onPrepareProjection;

  var self = this;

  return {
    validate: checkIdThenAuthorize (self._id, onAuthorize),

    execute: function __blueprint_update_execute (req, res, callback) {
      var rcId = req.params[self._id];
      var filter = {_id: rcId};

      async.waterfall ([
        // First, allow the subclass to update the filter.
        async.constant (filter),

        function (filter, callback) {
          return onUpdateFilter (req, filter, callback)
        },

        // Now, let's search our database for the resource in question.
        function (filter, callback) {
          var update = { $set: req.body[self._name] };
          var option = { upsert: false, new: true };

          onPrepareProjection (req, function (err, projection) {
            // Do not include the version field in the projection.
            option.fields = projection;

            if (isProjectionExclusive (projection) && projection['__v'] === undefined)
              option.fields.__v = 0;

            self._model.findOneAndUpdate (filter, update, option, makeDbCompletionHandler (callback));
          });
        },

        // Allow the subclass to do any post-execution analysis of the result.
        function (result, callback) { onPostExecute (req, result, callback); },

        // Rewrite the result in JSON API format.
        function (data, callback) {
          var result = { };
          result[self._name] = data;

          return callback (null, result);
        }
      ], makeTaskCompletionHandler (res, callback));
    }
  };
};

/**
 * Delete a single resource.
 *
 * @param opts
 * @returns
 */
ResourceController.prototype.delete = function (opts) {
  opts = opts || {};
  var on = opts.on || {};

  var onUpdateFilter = on.updateFilter || __onUpdateFilter;
  var onPostExecute = on.postExecute || __onPostExecute;
  var onAuthorize = on.authorize || __onAuthorize;
  var self = this;

  return {
    validate: checkIdThenAuthorize (self._id, onAuthorize),

    execute: function __blueprint_delete (req, res, callback) {
      var rcId = req.params[self._id];
      var filter = {_id: rcId};

      async.waterfall ([
        // First, allow the subclass to update the filter.
        async.constant (filter),

        function (filter, callback) {
          return onUpdateFilter (req, filter, callback)
        },

        // Now, let's search our database for the resource in question.
        function (filter, callback) {
          self._model.findOneAndRemove (filter, makeDbCompletionHandler (callback));
        },

        // Allow the subclass to do any post-execution analysis of the result.
        function (result, callback) { onPostExecute (req, result, callback); },

        // Make sure we return 'true'.
        function (result, callback) { return callback (null, true); }
      ], makeTaskCompletionHandler (res, callback));
    }
  };
};

module.exports = exports = ResourceController;
