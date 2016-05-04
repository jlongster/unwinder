
function format(obj) {
  if(obj === undefined) {
    return 'undefined';
  }
  else if(obj === null) {
    return 'null';
  }
  else if(_.isFunction(obj)) {
    return '<func>';
  }
  else {
    var str;

    if(typeof obj === 'object') {
      str = obj.toSource ? obj.toSource() : obj.toString();
    }
    else {
      str = obj.toString();
    }

    if(str.indexOf('\n') !== -1) {
      str = str.slice(0, str.indexOf('\n')) + '...';
    }
    return str;
  }
}

var client = new Connection(window.parent, 'child');
client.send({ type: 'ready' });

client.on('run', function(code, debugInfo) {
  VM.run(code, $DebugInfo.fromObject(debugInfo));
});
client.on('continue', VM.continue.bind(VM));
client.on('step', VM.step.bind(VM));
client.on('stepOver', VM.stepOver.bind(VM));

client.on('setDebugInfo', function(info) {
  VM.setDebugInfo($DebugInfo.fromObject(info));
});

client.on('query', function(names) {
  var res = names.split(',').map(function(name) {
    switch(name) {
    case 'state':
      return VM.getState();
    case 'scope':
      var top = VM.getTopFrame();
      if(!top) return [];

      return top.scope.map(function(v) { return v.name; });
    case 'stack':
      return VM.stack ? VM.stack.map(function(frame) {
        return {
          name: frame.name,
          scope: _.mapValues(frame.scope, format),
          loc: frame.getLocation(VM)
        };
      }) : [];
    }
  });

  this.respond(res);
});

client.on('eval', function(expr) {
  try {
    var r = VM.evaluate(expr);
  }
  catch(e) {
    this.respond([e.toString(), null]);
    return;
  }

  if(_.isArray(r)) {
    r = r.map(format);
  }
  else if(_.isObject(r)) {
    r = _.mapValues(r, format);
  }
  else {
    r = format(r);
  }
  this.respond([null, r]);
});

VM.on('breakpoint', function() {
  client.send({ type: 'breakpoint',
                args: [VM.getLocation()] });
});

// VM.on('step', function() {
//   client.send({ type: 'step' });
// });

VM.on('finish', function() {
  client.send({ type: 'finish' });
});

VM.on('error', function(err) {
  client.send({ type: 'error',
                args: [err.toString(), err.stack, VM.getLocation()]});
});

window.console = {
  log: function() {
    var str = Array.prototype.slice.call(arguments).join(' ');
    client.send({ type: 'log', args: [str] });
  }
};
