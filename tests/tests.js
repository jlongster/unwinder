var expect = require('expect.js');
var regenerator = require("../main");
require('../runtime/vm.js');

function run(fn) {
  var src = '(' + fn.toString() + ')()';
  var output = regenerator(src);
  var VM = new $Machine();
  VM.on('error', function(e) {
    throw e;
  });

  var func = new Function('expect', 'VM', '$Frame', output.code);
  var global = func(expect, VM, $Frame);

  VM.run(global, output.debugInfo);
  return VM;
}

describe('basic code', function() {
  it('should assign variables', function() {
    run(function() {
      var x = 10;
      expect(x).to.be(10);
      expect(y).to.be(undefined);
      var y = x + 5;
      expect(y).to.be(15);
    });
  });

  it('should work with binary operators', function() {
    run(function() {
      var x = 10 + 5 / 2 * 5;
      expect(x).to.be(22.5);
    });
  });

  it('should define functions', function() {
    run(function() {
      function foo(x) {
        return x + 5;
      }

      expect(foo(2)).to.be(7);
    });
  });

  it('should close over data', function() {
    run(function() {
      function bar(x) {
        return function(y) {
          return x + y;
        };
      }

      var z = bar(5);
      expect(z(10)).to.be(15);
      expect(z(20)).to.be(25);
    });
  });

  it('should work with for loops', function() {
    run(function() {
      var z = 5;
      for(var i=0; i<100; i++) {
        z++;
      }
      expect(z).to.be(105);
    });
  });

  it('should work with while loops', function() {
    run(function() {
      var z = 5;
      var i = 0;
      while(i < 100) {
        z++;
        i++;
      }
      expect(i).to.be(100);
      expect(z).to.be(105);

      z = 5;
      i = 0;
      do {
        z++;
        i++;
      } while(i < 200);
      expect(i).to.be(200);
      expect(z).to.be(205);
    });
  });

  it('should work with "new"', function() {
    var VM = run(function() {
      var arr = new Array(1000);
      expect(arr.length).to.be(1000);

      function Foo(x) {
        this.x = x;
      }

      var foo = new Foo(5);
      expect(foo.x).to.be(5);
    });
  });
});

describe('suspending', function() {
  it('should suspend on debugger', function() {
    var VM = run(function() {
      function foo() {
        var x = 1;
        debugger;
        x = 2;
        return x;
      }

      var res = foo();
      expect(res).to.be(4);
    });

    expect(VM.state).to.be('suspended');
    VM.continue();    
  });
});

