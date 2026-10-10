// Keep FunctionCode in static-site.json identical to this file.
// Rewrite only real entry points: missing assets/config must remain errors.
function handler(event) {
  var request = event.request;

  if (request.uri === '/recovery-v3') {
    var query = [];
    var parameters = request.querystring || {};
    Object.keys(parameters).forEach(function (name) {
      var parameter = parameters[name];
      var values = parameter.multiValue || [parameter];
      values.forEach(function (item) {
        // CloudFront keeps query components URL-encoded in the event.
        query.push(name + '=' + item.value);
      });
    });
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: {
          value: '/recovery-v3/' + (query.length ? '?' + query.join('&') : '')
        },
        'cache-control': { value: 'public, max-age=300' }
      }
    };
  }

  if (request.uri === '/') {
    request.uri = '/index.html';
  } else if (request.uri === '/recovery-v3/') {
    request.uri = '/recovery-v3/index.html';
  }

  return request;
}
