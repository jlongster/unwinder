var expect = require('expect.js');
var regenerator = require("../main");
require('../runtime/vm.js');

// util

var LOGGED = '';

function run(done, fn) {
  LOGGED = '';

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

  var func = new Function('expect', 'VM', '$Frame', 'print',
                          output.code + '\nreturn $__global');
  var global = func(expect, VM, $Frame, function(str) {
    LOGGED += str;
  });

  VM.run(global, output.debugInfo);
  return VM;
}

function getOutput() {
  return LOGGED;
}

function continueM(machine, cb) {
  machine.continue();
  setTimeout(cb, 0);
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

// tests

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

  it('should work with try/catch', function(done) {
    run(done, function() {
      var x = 5;

      try {
        x = 20;
        baz();
        x = 25;
        print('0');
      }
      catch(e) {
        expect(e.toString().indexOf('baz')).to.not.be(-1);
        print('1');
      }

      expect(x).to.be(20);
      print('2');

      function bar() {
        throw new Error('hello');
      }

      function foo() {
        try {
          x = 10;
          bar();
          x = 15;
          print('3');
        }
        catch(e) {
          expect(e.toString().indexOf('hello')).to.not.be(-1);
          print('4');
        }

        print('5');
        expect(x).to.be(10);
      }

      foo();
      expect(x).to.be(10);
    });

    expect(getOutput()).to.be('1245');
  });

  it('should execute finally blocks', function(done) {
    var VM = run(null, function() {
      var x = 5;

      try {
        x = 10;
        print('0');
        baz();
        x = 15;
        print('1');
      }
      finally {
        print('2');
        expect(x).to.be(10);
      }
    });

    VM.off('error');
    VM.on('error', function(e) {
      expect(getOutput()).to.be('02');
      expect(e.toString().indexOf('baz')).to.not.be(-1);
      done();
    });
  });

  it('should execute finally blocks (deep)', function(done) {
    var VM = run(null, function() {
      var x = 5;

      function bar() {
        throw new Error('dont tread on me');
      }

      function foo() {
        try {
          x = 10;
          print('0');
          bar();
          x = 15;
          print('1');
        }
        finally {
          print('2');
          expect(x).to.be(10);
        }
      }

      foo();
      print('3');
    });

    VM.off('error');
    VM.on('error', function(e) {
      expect(getOutput()).to.be('02');
      expect(e.toString().indexOf('dont tread on me')).to.not.be(-1);
      done();
    });
  });

  it('should work with try/catch/finally', function(done) {
    run(null, function() {
      var x = 5;

      function bar() {
        throw new Error('dont tread on me');
      }

      function foo() {
        try {
          x = 10;
          print('0');
          bar();
          x = 15;
          print('1');
        }
        catch(e) {
          print('2');
          expect(e.toString().indexOf('dont tread on me')).to.not.be(-1);
        }
        finally {
          print('3');
          expect(x).to.be(10);
        }
      }

      foo();
      print('4');
    });

    expect(getOutput()).to.be('0234');
    done();
  });

  it('should work with nested try/catch', function(done) {
    run(null, function() {
      var x = 5;

      function bar() {
        throw new Error('dont tread on me');
      }

      function foo() {
        try {
          try {
            print('0');
            bar();
            print('1');
          }
          catch(e) {
            print('2');
            expect(e.toString().indexOf('tread')).to.not.be(-1);
          }

          print('3');
          bar();
        }
        catch(e) {
          print('4');
          expect(e.toString().indexOf('tread')).to.not.be(-1);
        }
      }

      foo();
      print('5');
    });

    expect(getOutput()).to.be('02345');
    done();
  });

  it('should work with nested try/catch/finally', function(done) {
    run(null, function() {
      var x = 5;

      function bar() {
        throw new Error('dont tread on me');
      }

      function foo() {
        try {
          try {
            print('0');
            bar();
            print('1');
          }
          catch(e) {
            print('2');
            expect(e.toString().indexOf('tread')).to.not.be(-1);
          }
          finally {
            print('3');
          }

          print('4');
          bar();
        }
        catch(e) {
          print('5');
          expect(e.toString().indexOf('tread')).to.not.be(-1);
        }
        finally {
          print('6');
        }
      }

      foo();
      print('7');
    });

    expect(getOutput()).to.be('0234567');
    done();
  });

  it('should run finally with break', function(done) {
    run(null, function() {
      var x = 1;
      while(1) {
        print(x);
        try {
          if(x >= 3) {
            try {
              break;
            } finally {
              print('^');
            }
          }
        }
        finally {
          print('*');
        }

        x++;
        print('-');
      }

      print('done');
    });

    expect(getOutput()).to.be('1*-2*-3^*done');
    done();
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

  it('should close over functions appropriately (global)', function(done) {
    run(done, function() {
      function foo() {
        return function() {
          foo = 5;
        };
      }

      foo()();
      expect(foo).to.be(5);

      var bar = function bar() {
        return function() {
          bar = 6;
        };
      };

      var oldBar = bar;
      bar()();
      expect(bar).to.be(oldBar);

      var baz = function() {
        return function() {
          baz = 7;
        };
      };

      baz()();
      expect(baz).to.be(7);
    });
  });

  it('should close over functions appropriately (local)', function(done) {
    run(done, function() {
      function SCOPE() {
        function foo() {
          return function() {
            foo = 5;
          };
        }

        foo()();
        expect(foo).to.be(5);

        var bar = function bar() {
          return function() {
            bar = 6;
          };
        };

        var oldBar = bar;
        bar()();
        expect(bar).to.be(oldBar);

        var baz = function() {
          return function() {
            baz = 7;
          };
        };

        baz()();
        expect(baz).to.be(7);
      }

      SCOPE();
    });
  });
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
    expect(VM.rootFrame.ctx.next).to.be(11);
    continueM(VM, function() {
      expect(VM.state).to.be('suspended');
      expect(VM.rootFrame.ctx.next).to.be(34);
      continueM(VM, function() {
        expect(VM.state).to.be('idle');
      });
    });
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

    continueM(VM, function() {
      frames = getFrames(VM);
      expect(frames[2].state.y).to.be(15);
      continueM(VM, function() {
        expect(VM.state).to.be('idle');
      });
    });
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
    continueM(VM, function() {
      expect(VM.state).to.be('idle');
    });
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
    continueM(VM, function() {
      expect(VM.state).to.be('idle');
    });
  });

  it('should fix references with boxing', function(done) {
    var VM = run(done, function() {
      function foo() {
        var x = 5;

        var baz = function() {
          return x;
        };

        debugger;
        x = 10;
        return baz();
      }

      var res = foo(5);
      expect(res).to.be(10);
    });

    expect(VM.error).to.be(undefined);
    expect(VM.state).to.be('suspended');
    continueM(VM, function() {
      expect(VM.state).to.be('idle');
    });
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

    expect(VM.evaluate('x')).to.be(10);
    expect(VM.evaluate('y')).to.be(5);
    expect(VM.evaluate('z + y')).to.be(10);
    VM.continue();
    expect(VM.state).to.be('idle');
  });

  it('should keep outer state after evaluating', function() {
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
    expect(VM.state).to.be('idle');

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
  });

  function expectScopeChanges(VM) {
    expect(VM.evaluate('x')).to.be(1);
    expect(VM.evaluate('y')).to.be(5);
    expect(VM.evaluate('foo()')).to.be(1);
    expect(VM.evaluate('bar()')).to.be(5);
    expect(VM.evaluate('quux()')).to.be(6);
    VM.evaluate('x = 2');
    VM.evaluate('y = 10');
    expect(VM.evaluate('x')).to.be(2);
    expect(VM.evaluate('y')).to.be(10);
    expect(VM.evaluate('foo()')).to.be(2);
    expect(VM.evaluate('bar()')).to.be(10);
    expect(VM.evaluate('quux()')).to.be(12);
    VM.evaluate('function foo() { return x * 2 }');
    expect(VM.evaluate('foo()')).to.be(4);
    expect(VM.evaluate('quux()')).to.be(14);
  }

  it('should evaluate global scope correctly (idled)', function() {
    var VM = run(null, function() {
      var x = 1;
      var y = 5;

      function foo() {
        return x;
      }

      var bar = function() {
        return y;
      };

      function baz() {
        return function() {
          return foo() + y;
        };
      }

      var quux = baz();
    });

    expect(VM.error).to.be(undefined);
    expect(VM.state).to.be('idle');
    expectScopeChanges(VM);
  });

  it('should evaluate global scope correctly (suspended)', function() {
    var VM = run(null, function() {
      var x = 1;
      var y = 5;

      function foo() {
        return x;
      }

      var bar = function() {
        return y;
      };

      function baz() {
        return function() {
          return foo() + y;
        };
      }

      var quux = baz();
      debugger;
      var noop = -1;
    });

    expectScopeChanges(VM);
    continueM(VM, function() {
      expect(VM.state).to.be('idle');
    });
  });

  it('should evaluate local scope correctly (suspended)', function() {
    var VM = run(null, function() {
      function BAZZLE() {
        var x = 1;
        var y = 5;

        function foo() {
          return x;
        }

        var bar = function() {
          return y;
        };

        function baz() {
          return function() {
            return foo() + y;
          };
        }

        var quux = baz();
        debugger;
        var noop = -1;
      }

      BAZZLE();
    });

    expect(VM.state).to.be('suspended');
    expectScopeChanges(VM);
    continueM(VM, function() {
      expect(VM.state).to.be('idle');
    });
  });
});
