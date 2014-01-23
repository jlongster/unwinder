var regenerator = require("./main");
var runtime = require('./runtime/vm');

function foo() {
  return 2 + 2;
}

var src = foo.toString() + '\nvar y = 5 + 5; var z = foo(); console.log(z);';
var output = regenerator(src, { includeDebug: true });

//console.log(output.code);
//var code = require('fs').readFileSync('tmp.js', 'utf8');
var code = output.code;
var func = new Function('VM', '$Frame', code);

var VM = new $Machine();
VM.on('error', function(e) {
  throw e;
});

var global = func(VM, $Frame);
VM.run(global, output.debugInfo);
VM.evaluate('function foo() { return 4 + 4; }');

//VM.continue();

function evaluate(expr) {
  VM.evalArg = expr;
  VM.stepping = true;
  
  var prevNext = $ctx.next;
  $ctx.next = -1;
  $ctx.frame = true;

  global.$ctx = $ctx;
  global();
  console.log('evaled: ' + $ctx.rval);
  $ctx.next = prevNext;
}
