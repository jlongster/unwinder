
__debug_sourceURL="test.js";
(function(global) {
  var hasOwn = Object.prototype.hasOwnProperty;

  // vm

  var findingRoot = false;

  function invokeRoot(fn) {
    VM.state = EXECUTING;

    var ctx = fn.$ctx = getContext();
    ctx.softReset();
    fn();
    checkStatus(ctx);
  }

  function checkStatus(ctx) {
    if(ctx.frame) {
      ctx.frame.name = 'top-level';

      // machine was paused
      VM.state = VM.SUSPENDED;
      rootFrame = ctx.frame;

      if(VM.error) {
        VM.onError && VM.onError(VM.error);
        VM.error = null;
      }
      else if(VM.isStepping()) {
        VM.onStep && VM.onStep();
      }
      else {
        VM.onBreakpoint && VM.onBreakpoint();
      }

      VM.stepping = true;
    }
    else {
      if(VM.onFinish) {
        setTimeout(VM.onFinish, 0);
      }

      VM.state = VM.IDLE;
    }
  }

  function getTopFrame(frame) {
    var top = frame;
    while(top.child) {
      top = top.child;
    }
    return top;
  }

  var VM = global.VM = {};
  if(typeof exports !== 'undefined') {
    exports.VM = VM;
  }

  var originalSrc;
  var debugInfo;
  var curStack;

  VM.Frame = Frame;
  VM.getContext = getContext;
  VM.releaseContext = releaseContext;
  VM.invokeRoot = invokeRoot;
  VM.getTopFrame = function() {
    return getTopFrame(rootFrame);
  };

  VM.getFrameOffset = function(i) {
    // TODO: this is really annoying, but it works for now. have to do
    // two passes
    var top = rootFrame;
    var count = 0;
    while(top.child) {
      top = top.child;
      count++;
    }

    var depth = count - i;
    top = rootFrame;
    count = 0;
    while(top.child && count < depth) {
      top = top.child;
      count++;
    }

    return top;
  };

  VM.setDebugInfo = function(info) {
    debugInfo = info;
    VM.machineBreaks = new Array(debugInfo.length);

    for(var i=0, l=debugInfo.length; i<l; i++) {
      VM.machineBreaks[i] = [];
    }
  };

  VM.getRootFrame = function() {
    return rootFrame;
  };

  VM.run = function() {
    if(!rootFrame) return;

    // We need to get past this instruction that has a breakpoint, so
    // turn off breakpoints and step past it, then turn them back on
    // again and execute normally
    VM.stepping = true;
    VM.hasBreakpoints = false;
    rootFrame.restore();

    var nextFrame = rootFrame.ctx.frame;
    VM.hasBreakpoints = true;
    VM.stepping = false;
    nextFrame.restore();
    checkStatus(nextFrame.ctx);
  };

  VM.step = function() {
    if(!rootFrame) return;

    VM.stepping = true;
    VM.hasBreakpoints = false;
    rootFrame.restore();
    VM.hasBreakpoints = true;

    checkStatus(rootFrame.ctx);

    // rootFrame now points to the new stack
    var top = getTopFrame(rootFrame);

    if(VM.state === VM.SUSPENDED &&
       top.ctx.next === debugInfo[top.machineId].finalLoc) {
      // if it's waiting to simply return a value, go ahead and run
      // that step so the user doesn't have to step through each frame
      // return
      VM.step();
    }
  };

  VM.evaluate = function(expr) {
    if(expr === '$_') {
      return lastEval;
    }
    else if(rootFrame) {
      var top = VM.getTopFrame();
      var res = top.evaluate(expr);

      // switch frames to get any updated data
      var parent = VM.getFrameOffset(1);
      parent.child = res.frame;
      // fix the self-referencing pointer
      res.frame.ctx.frame = res.frame;

      lastEval = res.result;
      return lastEval;
    }
  };

  VM.reset = function() {
    rootFrame = null;
    debugInfo = null;
    VM.state = IDLE;
    VM.machineBreaks = [];
    VM.stepping = false;
  };

  VM.isStepping = function() {
    return VM.stepping;
  };

  VM.getLocation = function() {
    if(!rootFrame) return;

    var top = VM.getTopFrame();
    return debugInfo[top.machineId].locs[top.ctx.next];
  };

  VM.toggleBreakpoint = function(internalLoc) {
    if(!internalLoc) return;

    var machineId = internalLoc.machineId;
    var locId = internalLoc.locId;

    if(VM.machineBreaks[machineId][locId] === undefined) {
      VM.hasBreakpoints = true;
      VM.machineBreaks[internalLoc.machineId][internalLoc.locId] = true;
    }
    else {
      VM.machineBreaks[internalLoc.machineId][internalLoc.locId] = undefined;
    }

    return true;
  };

  VM.lineToInternalLoc = function(line) {
    for(var i=0, l=debugInfo.length; i<l; i++) {
      var locs = debugInfo[i].locs;
      var keys = Object.keys(locs);

      for(var cur=0, len=keys.length; cur<len; cur++) {
        var loc = locs[keys[cur]];
        if(loc.start.line === line) {
          return {
            machineId: i,
            locId: keys[cur]
          };
        }
      }
    }

    return null;
  };

  // TODO: I'm not sure we need this anymore. It should be
  // deterministic when a function returns by other various
  // heuristics.
  // var UndefinedValue = Object.create(null, {
  //   toString: function() { return 'undefined'; }
  // });

  var rootFrame;
  var lastEval;

  var IDLE = VM.IDLE = 1;
  var SUSPENDED = VM.SUSPENDED = 2;
  var EXECUTING = VM.EXECUTING = 3;

  // frame

  function Frame(machineId, name, fn, scope, outerScope,
                 thisPtr, ctx, child) {
    this.machineId = machineId;
    this.name = name;
    this.fn = fn;
    this.scope = scope;
    this.outerScope = outerScope;
    this.thisPtr = thisPtr;
    this.ctx = ctx;
    this.child = child;
  }

  Frame.prototype.restore = function() {
    this.fn.$ctx = this.ctx;
    this.fn.call(this.thisPtr);
  };

  Frame.prototype.evaluate = function(expr) {
    VM.evalArg = expr;
    VM.error = null;
    VM.stepping = true;

    // Convert this frame into a childless frame that will just
    // execute the eval instruction
    var savedChild = this.child;
    var ctx = new Context();
    ctx.next = -1;
    ctx.frame = this;
    this.child = null;

    this.fn.$ctx = ctx;
    this.fn.call(this.thisPtr);

    // Restore the stack
    this.child = savedChild;

    if(VM.error) {
      var err = VM.error;
      VM.error = null;
      throw err;
    }
    else {
      var newFrame = ctx.frame;
      newFrame.child = this.child;
      newFrame.ctx = this.ctx;

      return {
        result: ctx.rval,
        frame: newFrame
      };
    }
  };

  Frame.prototype.stackEach = function(func) {
    if(this.child) {
      this.child.stackEach(func);
    }
    func(this);
  };

  Frame.prototype.stackMap = function(func) {
    var res;
    if(this.child) {
      res = this.child.stackMap(func);
    }
    else {
      res = [];
    }

    res.push(func(this));
    return res;
  };

  Frame.prototype.stackReduce = function(func, acc) {
    if(this.child) {
      acc = this.child.stackReduce(func, acc);
    }

    return func(acc, this);
  };

  Frame.prototype.getExpression = function(src) {
    var loc = debugInfo[this.machineId].locs[this.ctx.next];

    if(loc && src) {
      var line = src.split('\n')[loc.start.line - 1];
      return line.slice(loc.start.column, loc.end.column);
    }
    return '';
  };

  // context

  function Context() {
    this.reset();
  }

  Context.prototype = {
    constructor: Context,

    reset: function(initialState) {
      this.softReset(initialState);

      // Pre-initialize at least 30 temporary variables to enable hidden
      // class optimizations for simple generators.
      for (var tempIndex = 0, tempName;
           hasOwn.call(this, tempName = "t" + tempIndex) || tempIndex < 30;
           ++tempIndex) {
        this[tempName] = null;
      }
    },

    softReset: function(initialState) {
      this.next = 0;
      this.lastNext = 0;
      this.sent = void 0;
      this.returned = void 0;
      this.state = initialState || EXECUTING;
      this.rval = void 0;
      this.tryStack = [];
      this.done = false;
      this.delegate = null;
      this.frame = null;
      this.childFrame = null;
      this.isCompiled = false;

      this.staticBreakpoint = false;
      this.stepping = false;
    },

    stop: function() {
      this.done = true;

      if (hasOwn.call(this, "thrown")) {
        var thrown = this.thrown;
        delete this.thrown;
        throw thrown;
      }

      // if(this.rval === UndefinedValue) {
      //   this.rval = undefined;
      // }

      // return this.rval;
    },

    keys: function(object) {
      return Object.keys(object).reverse();
    },

    pushTry: function(catchLoc, finallyLoc, finallyTempVar) {
      if (finallyLoc) {
        this.tryStack.push({
          finallyLoc: finallyLoc,
          finallyTempVar: finallyTempVar
        });
      }

      if (catchLoc) {
        this.tryStack.push({
          catchLoc: catchLoc
        });
      }
    },

    popCatch: function(catchLoc) {
      var lastIndex = this.tryStack.length - 1;
      var entry = this.tryStack[lastIndex];

      if (entry && entry.catchLoc === catchLoc) {
        this.tryStack.length = lastIndex;
      }
    },

    popFinally: function(finallyLoc) {
      var lastIndex = this.tryStack.length - 1;
      var entry = this.tryStack[lastIndex];

      if (!entry || !hasOwn.call(entry, "finallyLoc")) {
        entry = this.tryStack[--lastIndex];
      }

      if (entry && entry.finallyLoc === finallyLoc) {
        this.tryStack.length = lastIndex;
      }
    },

    dispatchException: function(exception) {
      var finallyEntries = [];
      var dispatched = false;

      if (this.done) {
        throw exception;
      }

      // Dispatch the exception to the "end" location by default.
      this.thrown = exception;
      this.next = "end";

      for (var i = this.tryStack.length - 1; i >= 0; --i) {
        var entry = this.tryStack[i];
        if (entry.catchLoc) {
          this.next = entry.catchLoc;
          dispatched = true;
          break;
        } else if (entry.finallyLoc) {
          finallyEntries.push(entry);
          dispatched = true;
        }
      }

      while ((entry = finallyEntries.pop())) {
        this[entry.finallyTempVar] = this.next;
        this.next = entry.finallyLoc;
      }
    },

    delegateYield: function(generator, resultName, nextLoc) {
      var info = generator.next(this.sent);

      if (info.done) {
        this.delegate = null;
        this[resultName] = info.value;
        this.next = nextLoc;

        return ContinueSentinel;
      }

      this.delegate = {
        generator: generator,
        resultName: resultName,
        nextLoc: nextLoc
      };

      return info.value;
    }
  };

  // cache

  var cacheSize = 30000;
  var _contexts = new Array(cacheSize);
  var contextptr = 0;
  for(var i=0; i<cacheSize; i++) {
    _contexts[i] = new Context();
  }

  function getContext() {
    if(contextptr < cacheSize) {
      return _contexts[contextptr++];
    }
    else {
      return new Context();
    }
  }

  function releaseContext() {
    contextptr--;
  }
}).call(this, (function() { return this; })());

VM.setDebugInfo([{
  "finalLoc": 33,

  "locs": {
    "0": {
      "start": {
        "line": 2,
        "column": 0
      },

      "end": {
        "line": 6,
        "column": 1
      }
    },

    "1": {
      "start": {
        "line": 2,
        "column": 0
      },

      "end": {
        "line": 6,
        "column": 1
      }
    },

    "3": {
      "start": {
        "line": 8,
        "column": 8
      },

      "end": {
        "line": 8,
        "column": 20
      }
    },

    "12": {
      "start": {
        "line": 8,
        "column": 4
      },

      "end": {
        "line": 8,
        "column": 20
      }
    },

    "13": {
      "start": {
        "line": 8,
        "column": 4
      },

      "end": {
        "line": 8,
        "column": 20
      }
    },

    "15": {
      "start": {
        "line": 9,
        "column": 12
      },

      "end": {
        "line": 9,
        "column": 17
      }
    },

    "24": {
      "start": {
        "line": 9,
        "column": 0
      },

      "end": {
        "line": 9,
        "column": 18
      }
    }
  }
}, {
  "finalLoc": 3,

  "locs": {
    "0": {
      "start": {
        "line": 3,
        "column": 2
      },

      "end": {
        "line": 5,
        "column": 3
      }
    },

    "1": {
      "start": {
        "line": 3,
        "column": 2
      },

      "end": {
        "line": 5,
        "column": 3
      }
    }
  }
}, {
  "finalLoc": 4,

  "locs": {
    "0": {
      "start": {
        "line": 4,
        "column": 4
      },

      "end": {
        "line": 4,
        "column": 17
      }
    }
  }
}]);

VM.invokeRoot(function $anon1() {
  var foo, f;
  var $ctx = $anon1.$ctx;

  if ($ctx === undefined)
    return VM.invokeRoot($anon1);

  $ctx.isCompiled = true;

  try {
    if ($ctx.frame) {
      foo = $ctx.frame.scope.foo;
      f = $ctx.frame.scope.f;
      var $child = $ctx.frame.child;

      if ($child) {
        var $child$ctx = $child.ctx;
        $child.fn.$ctx = $child$ctx;
        $child.fn.call($child.thisPtr);

        if ($child$ctx.frame) {
          $ctx.frame.child = $child$ctx.frame;
          return;
        } else {
          $ctx.frame = null;
          $ctx.childFrame = null;
          $ctx[$ctx.resultLoc] = $child$ctx.rval;

          if (VM.stepping)
            throw null;
        }
      } else {
        if ($ctx.staticBreakpoint)
          $ctx.next = $ctx.next + 3;

        $ctx.frame = null;
        $ctx.childFrame = null;
      }
    } else if (VM.stepping)
      throw null;

    while (1) {
      if (VM.hasBreakpoints && VM.machineBreaks[0][$ctx.next] !== undefined)
        break;

      switch ($ctx.next) {
      case 0:
        foo = function foo(x, y, z) {
          var bar;
          var $ctx = foo.$ctx;

          if ($ctx === undefined)
            return VM.invokeRoot(foo);

          $ctx.isCompiled = true;

          try {
            if ($ctx.frame) {
              x = $ctx.frame.scope.x;
              y = $ctx.frame.scope.y;
              z = $ctx.frame.scope.z;
              bar = $ctx.frame.scope.bar;
              var $child = $ctx.frame.child;

              if ($child) {
                var $child$ctx = $child.ctx;
                $child.fn.$ctx = $child$ctx;
                $child.fn.call($child.thisPtr);

                if ($child$ctx.frame) {
                  $ctx.frame.child = $child$ctx.frame;
                  return;
                } else {
                  $ctx.frame = null;
                  $ctx.childFrame = null;
                  $ctx[$ctx.resultLoc] = $child$ctx.rval;

                  if (VM.stepping)
                    throw null;
                }
              } else {
                if ($ctx.staticBreakpoint)
                  $ctx.next = $ctx.next + 3;

                $ctx.frame = null;
                $ctx.childFrame = null;
              }
            } else if (VM.stepping)
              throw null;

            while (1) {
              if (VM.hasBreakpoints && VM.machineBreaks[1][$ctx.next] !== undefined)
                break;

              switch ($ctx.next) {
              case 0:
                bar = function bar(w) {
                  var $ctx = bar.$ctx;

                  if ($ctx === undefined)
                    return VM.invokeRoot(bar);

                  $ctx.isCompiled = true;

                  try {
                    if ($ctx.frame) {
                      w = $ctx.frame.scope.w;
                      var $child = $ctx.frame.child;

                      if ($child) {
                        var $child$ctx = $child.ctx;
                        $child.fn.$ctx = $child$ctx;
                        $child.fn.call($child.thisPtr);

                        if ($child$ctx.frame) {
                          $ctx.frame.child = $child$ctx.frame;
                          return;
                        } else {
                          $ctx.frame = null;
                          $ctx.childFrame = null;
                          $ctx[$ctx.resultLoc] = $child$ctx.rval;

                          if (VM.stepping)
                            throw null;
                        }
                      } else {
                        if ($ctx.staticBreakpoint)
                          $ctx.next = $ctx.next + 3;

                        $ctx.frame = null;
                        $ctx.childFrame = null;
                      }
                    } else if (VM.stepping)
                      throw null;

                    while (1) {
                      if (VM.hasBreakpoints && VM.machineBreaks[2][$ctx.next] !== undefined)
                        break;

                      switch ($ctx.next) {
                      case 0:
                        $ctx.rval = x + w;
                        delete $ctx.thrown;
                        $ctx.next = 4;
                        break;
                      case 4:
                        return $ctx.stop();
                      case -1:
                        $ctx.rval = eval(VM.evalArg);
                      }

                      if (VM.stepping)
                        break;
                    }
                  }catch (e) {
                    VM.error = e;
                  }

                  $ctx.frame = new VM.Frame(2, "bar", bar, {
                    "w": w
                  }, ["x", "y", "z", "bar", "foo", "f"], this, $ctx, $ctx.childFrame);
                };

                $ctx.next = 3;
                break;
              case 3:
                return $ctx.stop();
              case -1:
                $ctx.rval = eval(VM.evalArg);
              }

              if (VM.stepping)
                break;
            }
          }catch (e) {
            VM.error = e;
          }

          $ctx.frame = new VM.Frame(1, "foo", foo, {
            "x": x,
            "y": y,
            "z": z,
            "bar": bar
          }, ["foo", "f"], this, $ctx, $ctx.childFrame);
        };

        $ctx.next = 3;
        break;
      case 3:
        var $t1 = VM.getContext();

        if (foo)
          foo.$ctx = $t1;

        $t1.softReset();
        var $t2 = foo(1, 2, 3);
        $ctx.next = 12;

        if ($t1.frame) {
          $ctx.childFrame = $t1.frame;
          $ctx.resultLoc = "t0";
          VM.stepping = true;
          break;
        }

        $ctx.t0 = ($t1.isCompiled ? $t1.rval : $t2);
        VM.releaseContext();
        break;
      case 12:
        f = $ctx.t0;
        $ctx.next = 15;
        break;
      case 15:
        var $t6 = VM.getContext();

        if (f)
          f.$ctx = $t6;

        $t6.softReset();
        var $t7 = f(20);
        $ctx.next = 24;

        if ($t6.frame) {
          $ctx.childFrame = $t6.frame;
          $ctx.resultLoc = "t5";
          VM.stepping = true;
          break;
        }

        $ctx.t5 = ($t6.isCompiled ? $t6.rval : $t7);
        VM.releaseContext();
        break;
      case 24:
        var $t4 = VM.getContext();

        if (console.log)
          console.log.$ctx = $t4;

        $t4.softReset();
        var $t8 = console.log($ctx.t5);
        $ctx.next = 33;

        if ($t4.frame) {
          $ctx.childFrame = $t4.frame;
          $ctx.resultLoc = "t3";
          VM.stepping = true;
          break;
        }

        $ctx.t3 = ($t4.isCompiled ? $t4.rval : $t8);
        VM.releaseContext();
        break;
      case 33:
        return $ctx.stop();
      case -1:
        $ctx.rval = eval(VM.evalArg);
      }

      if (VM.stepping)
        break;
    }
  }catch (e) {
    VM.error = e;
  }

  $ctx.frame = new VM.Frame(0, "$anon1", $anon1, {
    "foo": foo,
    "f": f
  }, [], this, $ctx, $ctx.childFrame);
}, this);
