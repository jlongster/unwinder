var expect = require('expect.js');
var regenerator = require("../main");
require('../runtime/vm.js');

function run(done, fn) {
  var src = fn.toString().trim();
  src = src.replace(/^function\s*\(\)\s*{/, '');
  src = src.replace(/\}$/, '');

  var output = regenerator(src);
  var VM = new $Machine();
  VM.on('error', function(e) {
    throw e;
  });

  if(done) {
    VM.on('finish', done);
  }

  var func = new Function('expect', 'VM', '$Frame', output.code);
  var global = func(expect, VM, $Frame);

  VM.run(global, output.debugInfo);
  return VM;
}

function getFrames(vm) {
  var frames = [];
  var frame = vm.rootFrame;
  while(frame) {
    frames.push(frame);
    frame = frame.child;
  }
  return frames;
}

describe('basic code', function() {
  it('should assign variables', function(done) {
    run(done, function() {
      var x = 10;
      expect(x).to.be(10);
      expect(y).to.be(undefined);
      var y = x + 5;
      expect(y).to.be(15);
    });
  });

  it('should work with binary operators', function(done) {
    run(done, function() {
      var x = 10 + 5 / 2 * 5;
      expect(x).to.be(22.5);
    });
  });

  it('should define functions', function(done) {
    run(done, function() {
      function foo(x) {
        return x + 5;
      }

      expect(foo(2)).to.be(7);
    });
  });

  it('should call functions', function(done) {
    run(done, function() {
      function foo(n) {
        if(n > 0) {
          return n + foo(n - 1);
        }
        return n;
      }

      expect(foo(1000)).to.be(500500);
    });
  });

  it('should close over data', function(done) {
    run(done, function() {
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

  it('should work with for loops', function(done) {
    run(done, function() {
      var z = 5;
      for(var i=0; i<100; i++) {
        z++;
      }
      expect(z).to.be(105);
    });
  });

  it('should work with while loops', function(done) {
    run(done, function() {
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

  // it('should work with "new"', function(done) {
  //   var VM = run(done, function() {
  //     var arr = new Array(1000);
  //     expect(arr.length).to.be(1000);

  //     function Foo(x) {
  //       this.x = x;
  //     }

  //     var foo = new Foo(5);
  //     expect(foo.x).to.be(5);
  //   });
  // });
});

describe('suspending', function() {
  it('should suspend on debugger', function(done) {
    var VM = run(done, function() {
      function foo() {
        var x = 1;
        debugger;
        x = 2;
        return x;
      }

      var res = foo();
      expect(res).to.be(2);

      debugger;
    });

    expect(VM.state).to.be('suspended');
    expect(VM.rootFrame.ctx.next).to.be(12);
    VM.continue();
    expect(VM.state).to.be('suspended');
    expect(VM.rootFrame.ctx.next).to.be(37);
    VM.continue();
    expect(VM.state).to.be('idle');
  });

  it('should save values on stack', function(done) {
    var VM = run(done, function() {
      function bar(y) {
        debugger;
        y = 15;
        debugger;
        expect(y).to.be(15);
      }

      function foo() {
        var x = 5;
        bar(10);
        expect(x).to.be(5);
      }

      var global = 1;
      foo();
      expect(global).to.be(1);
    });

    expect(VM.state).to.be('suspended');
    var frames = getFrames(VM);
    expect(frames.length).to.be(3);
    expect(frames[0].state.global).to.be(1);
    expect(frames[1].state.x).to.be(5);
    expect(frames[2].state.y).to.be(10);

    VM.continue();
    frames = getFrames(VM);
    expect(frames[2].state.y).to.be(15);
    VM.continue();
    expect(VM.state).to.be('idle');
  });

  it('should work with recursive functions', function(done) {
    var VM = run(done, function() {
      function foo(n) {
        if(n > 0) {
          return n + foo(n - 1);
        }
        debugger;
        return 0;
      }

      var x = foo(100);
      expect(x).to.be(5050);
    });

    expect(VM.state).to.be('suspended');
    var frames = getFrames(VM);
    expect(frames.length).to.be(102);
    expect(frames[55].state.n).to.be(46);
    VM.continue();
    expect(VM.state).to.be('idle');
  });

  it('should save closures', function(done) {
    var VM = run(done, function() {
      function foo(x) {
        var y = 5;
        return function(z) {
          debugger;
          return x + y + z;
        };
      }

      expect(foo(10)(5)).to.be(20);
    });

    expect(VM.state).to.be('suspended');
    var frames = getFrames(VM);
    expect(frames.length).to.be(2);
    expect(frames[1].state.z).to.be(5);
    expect(frames[1].scope[0].name).to.be('z');
    expect(frames[1].scope[1].name).to.be('foo');
    expect(frames[1].scope[2].name).to.be('x');
    expect(frames[1].scope[2].boxed).to.be(true);
    expect(frames[1].scope[3].name).to.be('y');
    expect(frames[1].scope[3].boxed).to.be(true);
    VM.continue();
    expect(VM.state).to.be('idle');
  });

  it('should evaluate expressions', function(done) {
    var VM = run(null, function() {
      function foo(x) {
        var y = 5;
        return function(z) {
          debugger;
          return x + y + z;
        };
      }

      expect(foo(10)(5)).to.be(20);
    });

    VM.on('finish', function() {
      expect(VM.state).to.be('idle');

      // program is done, should evaluate globally
      var foo = typeof(VM.evaluate('foo'));
      expect(foo).to.be('function');
      done();
    });

    // TODO: properly box/unbox for eval
    expect(VM.evaluate('x')).to.eql([10]);
    expect(VM.evaluate('y')).to.eql([5]);
    expect(VM.evaluate('z + y[0]')).to.be(10);
    VM.continue();
  });

  it('should keep outer state after evaluating', function(done) {
    var VM = run(null, function() {
      var x = 0;

      function foo() {
        x++;
      }

      foo();
    });

    // don't use the 'finish' event because that's fired any time the
    // machine stops executing, which will be multiple times. that
    // means we have to manually check the error (otherwise it's
    // thrown async)
    expect(VM.error).to.be(undefined);

    expect(VM.evaluate('x')).to.be(1);
    VM.evaluate('x++');
    VM.evaluate('x++');
    expect(VM.evaluate('x')).to.be(3);
    VM.evaluate('foo()');
    VM.evaluate('foo()');
    expect(VM.evaluate('x')).to.be(5);
    VM.evaluate('function foo() { x += 2; }');
    VM.evaluate('foo()');
    VM.evaluate('foo()');
    expect(VM.evaluate('x')).to.be(9);
    done();
  });
});
