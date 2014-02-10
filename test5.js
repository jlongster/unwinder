var regenerator = require("./main");
var runtime = require('./runtime/vm');

var src = require('fs').readFileSync('test.js', 'utf8');
var output = regenerator(src, { asExpr: true,
                                scope: [{name: 'x',
                                         boxed: true}]});

var code = output.code;
console.log(code);
// var func = new Function('VM', '$Frame', code);

// var VM = new $Machine();
// VM.on('error', function(e) {
//   throw e;
// });

// var global = func(VM, $Frame);
// VM.run(global, output.debugInfo);
// VM.evaluate('var x = 0');
// console.log(VM.evaluate('x'));

//VM.continue();
