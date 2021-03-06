var blueprint = require ('../../lib')
  ;

var schema = new blueprint.Schema ({
  /// Username for the account.
  first_name : { type: String, trim: true, required: true },

  /// Encrypted password
  last_name : { type: String, trim: true, required: true},
});

const COLLECTION_NAME  = 'blueprint_person';
module.exports = exports = blueprint.model (COLLECTION_NAME, schema);
