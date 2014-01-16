
__debug_sourceURL="test3.js";
(function(global) {
  var hasOwn = Object.prototype.hasOwnProperty;

  // vm

  var findingRoot = false;

  function invokeRoot(fn, self) {
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

      if(VM.isStepping()) {
        VM.onStep && VM.onStep();
      }
      else {
        VM.onBreakpoint && VM.onBreakpoint();
      }

      VM.stepping = true;
    }
    else {
      VM.reset();
      VM.onFinish && VM.onFinish();
    }
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
  };

  VM.evaluate = function(expr) {
    if(expr === '$_') {
      return lastEval;
    }
    else if(curFrame) {
      lastEval = curFrame.evaluate(expr);
      return lastEval;
    }
  };

  VM.reset = function(hard) {
    VM.state = IDLE;
    curFrame = null;
    rootFrame = null;

    if(hard) {
      debugInfo = null;
      machineBreaks = [];
    }
  };

  VM.isStepping = function() {
    return VM.stepping;
  };

  VM.getLocation = function() {
    if(!rootFrame) return;

    var leaf = rootFrame;
    while(leaf.child) {
      leaf = leaf.child;
    }

    return debugInfo[leaf.machineId].locs[leaf.ctx.next];
  };

  VM.toggleBreakpoint = function(internalLoc) {
    var machineId = internalLoc.machineId;
    var locId = internalLoc.locId;

    if(VM.machineBreaks[machineId][locId] === undefined) {
      VM.hasBreakpoints = true;
      VM.machineBreaks[internalLoc.machineId][internalLoc.locId] = true;

      console.log('turned on ', internalLoc.machineId, internalLoc.locId);
    }
    else {
      VM.machineBreaks[internalLoc.machineId][internalLoc.locId] = undefined;
    }
  };

  VM.lineToInternalLoc = function(line) {
    for(var i=0, l=debugInfo.length; i<l; i++) {
      var locs = debugInfo[i].locs;
      var keys = Object.keys(locs);

      for(var cur=0, len=keys.length; cur<len; cur++) {
        var loc = locs[keys[cur]];
        if(loc.start.line === line) {
          console.log(loc);
          console.log(keys[cur]);

          return {
            machineId: i,
            locId: keys[cur]
          };
        }
      }
    }

    return null;
  };

  var UndefinedValue = Object.create(null);
  var rootFrame;
  var curFrame;
  var lastEval;

  var IDLE = VM.IDLE = 1;
  var SUSPENDED = VM.SUSPENDED = 2;
  var EXECUTING = VM.EXECUTING = 3;

  function Frame(machineId, name, fn, scope, thisPtr, ctx, child) {
    this.machineId = machineId;
    this.name = name;
    this.fn = fn;
    this.scope = scope;
    this.thisPtr = thisPtr;
    this.ctx = ctx;
    this.child = child;
  }

  Frame.prototype.restore = function() {
    var ctx = this.ctx;
    ctx.stepping = VM.isStepping();
    this.fn.$ctx = ctx;
    this.fn.call(this.thisPtr);
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

  Frame.prototype.getSavedLoc = function() {
    return debugInfo[this.machineId].locs[this.savedNext];
  };

  Frame.prototype.getFinalLoc = function() {
    return debugInfo[this.machineId].finalLoc;
  };

  Frame.prototype.getEvalLoc = function() {
    return debugInfo[this.machineId].evalLoc;
  };

  Frame.prototype.getExpression = function() {
    //console.log(this.machineId, context.debugIdx || context.next);

    var loc = this.getLoc();
    if(loc && originalSrc) {
      var line = originalSrc[loc.start.line - 1];
      return line.slice(loc.start.column, loc.end.column);
    }
  };

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
      this.rval = UndefinedValue;
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

      //return this.rval;
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
  "finalLoc": 31,

  "locs": {
    "0": {
      "start": {
        "line": 2,
        "column": 0
      },

      "end": {
        "line": 9,
        "column": 1
      }
    },

    "1": {
      "start": {
        "line": 2,
        "column": 0
      },

      "end": {
        "line": 9,
        "column": 1
      }
    },

    "3": {
      "start": {
        "line": 11,
        "column": 0
      },

      "end": {
        "line": 17,
        "column": 1
      }
    },

    "4": {
      "start": {
        "line": 11,
        "column": 0
      },

      "end": {
        "line": 17,
        "column": 1
      }
    },

    "6": {
      "start": {
        "line": 19,
        "column": 0
      },

      "end": {
        "line": 27,
        "column": 1
      }
    },

    "7": {
      "start": {
        "line": 19,
        "column": 0
      },

      "end": {
        "line": 27,
        "column": 1
      }
    },

    "9": {
      "start": {
        "line": 29,
        "column": 0
      },

      "end": {
        "line": 34,
        "column": 1
      }
    },

    "10": {
      "start": {
        "line": 29,
        "column": 0
      },

      "end": {
        "line": 34,
        "column": 1
      }
    },

    "12": {
      "start": {
        "line": 36,
        "column": 0
      },

      "end": {
        "line": 38,
        "column": 1
      }
    },

    "13": {
      "start": {
        "line": 36,
        "column": 0
      },

      "end": {
        "line": 38,
        "column": 1
      }
    },

    "15": {
      "start": {
        "line": 40,
        "column": 12
      },

      "end": {
        "line": 40,
        "column": 17
      }
    },

    "23": {
      "start": {
        "line": 40,
        "column": 0
      },

      "end": {
        "line": 40,
        "column": 18
      }
    }
  }
}, {
  "finalLoc": 20,

  "locs": {
    "0": {
      "start": {
        "line": 3,
        "column": 6
      },

      "end": {
        "line": 3,
        "column": 11
      }
    },

    "1": {
      "start": {
        "line": 3,
        "column": 6
      },

      "end": {
        "line": 3,
        "column": 11
      }
    },

    "3": {
      "start": {
        "line": 4,
        "column": 6
      },

      "end": {
        "line": 4,
        "column": 26
      }
    },

    "4": {
      "start": {
        "line": 4,
        "column": 6
      },

      "end": {
        "line": 4,
        "column": 26
      }
    },

    "6": {
      "start": {
        "line": 5,
        "column": 15
      },

      "end": {
        "line": 5,
        "column": 18
      }
    },

    "7": {
      "start": {
        "line": 5,
        "column": 15
      },

      "end": {
        "line": 5,
        "column": 18
      }
    },

    "8": {
      "start": {
        "line": 5,
        "column": 10
      },

      "end": {
        "line": 5,
        "column": 11
      }
    },

    "11": {
      "start": {
        "line": 6,
        "column": 4
      },

      "end": {
        "line": 6,
        "column": 15
      }
    },

    "12": {
      "start": {
        "line": 6,
        "column": 4
      },

      "end": {
        "line": 6,
        "column": 15
      }
    },

    "16": {
      "start": {
        "line": 8,
        "column": 2
      },

      "end": {
        "line": 8,
        "column": 11
      }
    }
  }
}, {
  "finalLoc": 29,

  "locs": {
    "0": {
      "start": {
        "line": 12,
        "column": 6
      },

      "end": {
        "line": 12,
        "column": 12
      }
    },

    "1": {
      "start": {
        "line": 12,
        "column": 6
      },

      "end": {
        "line": 12,
        "column": 12
      }
    },

    "3": {
      "start": {
        "line": 13,
        "column": 10
      },

      "end": {
        "line": 13,
        "column": 13
      }
    },

    "4": {
      "start": {
        "line": 13,
        "column": 10
      },

      "end": {
        "line": 13,
        "column": 13
      }
    },

    "6": {
      "start": {
        "line": 13,
        "column": 15
      },

      "end": {
        "line": 13,
        "column": 18
      }
    },

    "9": {
      "start": {
        "line": 14,
        "column": 4
      },

      "end": {
        "line": 14,
        "column": 9
      }
    },

    "10": {
      "start": {
        "line": 14,
        "column": 4
      },

      "end": {
        "line": 14,
        "column": 9
      }
    },

    "12": {
      "start": {
        "line": 13,
        "column": 20
      },

      "end": {
        "line": 13,
        "column": 23
      }
    },

    "13": {
      "start": {
        "line": 13,
        "column": 20
      },

      "end": {
        "line": 13,
        "column": 23
      }
    },

    "17": {
      "start": {
        "line": 16,
        "column": 9
      },

      "end": {
        "line": 16,
        "column": 16
      }
    },

    "25": {
      "start": {
        "line": 16,
        "column": 2
      },

      "end": {
        "line": 16,
        "column": 17
      }
    }
  }
}, {
  "finalLoc": 22,

  "locs": {
    "0": {
      "start": {
        "line": 20,
        "column": 6
      },

      "end": {
        "line": 20,
        "column": 12
      }
    },

    "1": {
      "start": {
        "line": 20,
        "column": 6
      },

      "end": {
        "line": 20,
        "column": 12
      }
    },

    "3": {
      "start": {
        "line": 22,
        "column": 4
      },

      "end": {
        "line": 22,
        "column": 9
      }
    },

    "4": {
      "start": {
        "line": 22,
        "column": 4
      },

      "end": {
        "line": 22,
        "column": 9
      }
    },

    "6": {
      "start": {
        "line": 23,
        "column": 4
      },

      "end": {
        "line": 23,
        "column": 7
      }
    },

    "7": {
      "start": {
        "line": 23,
        "column": 4
      },

      "end": {
        "line": 23,
        "column": 7
      }
    },

    "9": {
      "start": {
        "line": 24,
        "column": 10
      },

      "end": {
        "line": 24,
        "column": 15
      }
    },

    "10": {
      "start": {
        "line": 26,
        "column": 9
      },

      "end": {
        "line": 26,
        "column": 18
      }
    },

    "18": {
      "start": {
        "line": 26,
        "column": 2
      },

      "end": {
        "line": 26,
        "column": 19
      }
    }
  }
}, {
  "finalLoc": 30,

  "locs": {
    "0": {
      "start": {
        "line": 30,
        "column": 5
      },

      "end": {
        "line": 30,
        "column": 10
      }
    },

    "3": {
      "start": {
        "line": 31,
        "column": 11
      },

      "end": {
        "line": 31,
        "column": 17
      }
    },

    "11": {
      "start": {
        "line": 31,
        "column": 24
      },

      "end": {
        "line": 31,
        "column": 29
      }
    },

    "14": {
      "start": {
        "line": 31,
        "column": 20
      },

      "end": {
        "line": 31,
        "column": 30
      }
    },

    "22": {
      "start": {
        "line": 31,
        "column": 4
      },

      "end": {
        "line": 31,
        "column": 31
      }
    },

    "26": {
      "start": {
        "line": 33,
        "column": 2
      },

      "end": {
        "line": 33,
        "column": 13
      }
    }
  }
}, {
  "finalLoc": 12,

  "locs": {
    "0": {
      "start": {
        "line": 37,
        "column": 9
      },

      "end": {
        "line": 37,
        "column": 19
      }
    },

    "8": {
      "start": {
        "line": 37,
        "column": 2
      },

      "end": {
        "line": 37,
        "column": 20
      }
    }
  }
}]);

var root = (function $anon1() {
  var quux, mumble, baz, bar, foo;
  var $ctx = $anon1.$ctx;
  $ctx.isCompiled = true;

  if ($ctx.frame) {
    quux = $ctx.frame.scope.quux;
    mumble = $ctx.frame.scope.mumble;
    baz = $ctx.frame.scope.baz;
    bar = $ctx.frame.scope.bar;
    foo = $ctx.frame.scope.foo;
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
      }
    } else {
      if ($ctx.staticBreakpoint)
        $ctx.next = $ctx.next + 3;

      $ctx.frame = null;
      $ctx.childFrame = null;
    }
  }

  while (1) {
    if (VM.hasBreakpoints && VM.machineBreaks[0][$ctx.next] !== undefined)
      break;

    switch ($ctx.next) {
    case 0:
      quux = function quux(i) {
        var z, obj, k;
        var $ctx = quux.$ctx;
        $ctx.isCompiled = true;

        if ($ctx.frame) {
          i = $ctx.frame.scope.i;
          z = $ctx.frame.scope.z;
          obj = $ctx.frame.scope.obj;
          k = $ctx.frame.scope.k;
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
            }
          } else {
            if ($ctx.staticBreakpoint)
              $ctx.next = $ctx.next + 3;

            $ctx.frame = null;
            $ctx.childFrame = null;
          }
        }

        while (1) {
          if (VM.hasBreakpoints && VM.machineBreaks[1][$ctx.next] !== undefined)
            break;

          switch ($ctx.next) {
          case 0:
            z = 1;
            $ctx.next = 3;
            break;
          case 3:
            obj = {
              x: 1,
              y: 2
            };

            $ctx.next = 6;
            break;
          case 6:
            $ctx.t0 = $ctx.keys(obj);
          case 7:
            if (!$ctx.t0.length) {
              $ctx.next = 16;
              break;
            }

            k = $ctx.t0.pop();
            $ctx.next = 11;
            break;
          case 11:
            z *= obj[k];
            $ctx.next = 7;
            break;
          case 14:
            $ctx.next = 7;
            break;
          case 16:
            $ctx.rval = z;
            delete $ctx.thrown;
            $ctx.next = 20;
            break;
          case 20:
            return $ctx.stop();
          }

          if (VM.stepping)
            break;
        }

        $ctx.frame = new VM.Frame(1, "quux", quux, {
          "i": i,
          "z": z,
          "obj": obj,
          "k": k
        }, this, $ctx, $ctx.childFrame);
      };

      $ctx.next = 3;
      break;
    case 3:
      mumble = function mumble(i) {
        var z, j;
        var $ctx = mumble.$ctx;
        $ctx.isCompiled = true;

        if ($ctx.frame) {
          i = $ctx.frame.scope.i;
          z = $ctx.frame.scope.z;
          j = $ctx.frame.scope.j;
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
            }
          } else {
            if ($ctx.staticBreakpoint)
              $ctx.next = $ctx.next + 3;

            $ctx.frame = null;
            $ctx.childFrame = null;
          }
        }

        while (1) {
          if (VM.hasBreakpoints && VM.machineBreaks[2][$ctx.next] !== undefined)
            break;

          switch ($ctx.next) {
          case 0:
            z = 10;
            $ctx.next = 3;
            break;
          case 3:
            j = 0;
            $ctx.next = 6;
            break;
          case 6:
            if (!(j < i)) {
              $ctx.next = 17;
              break;
            }

            $ctx.next = 9;
            break;
          case 9:
            z = j;
            $ctx.next = 12;
            break;
          case 12:
            j++;
            $ctx.next = 6;
            break;
          case 15:
            $ctx.next = 6;
            break;
          case 17:
            var $t2 = quux.$ctx = VM.getContext();
            $t2.softReset();
            var $t3 = quux(z);
            $ctx.next = 25;

            if ($t2.frame) {
              $ctx.childFrame = $t2.frame;
              $ctx.resultLoc = "t1";
              VM.stepping = true;
              break;
            }

            $ctx.t1 = ($t2.isCompiled ? $t2.rval : $t3);
            VM.releaseContext();
            break;
          case 25:
            $ctx.rval = $ctx.t1;
            delete $ctx.thrown;
            $ctx.next = 29;
            break;
          case 29:
            return $ctx.stop();
          }

          if (VM.stepping)
            break;
        }

        $ctx.frame = new VM.Frame(2, "mumble", mumble, {
          "i": i,
          "z": z,
          "j": j
        }, this, $ctx, $ctx.childFrame);
      };

      $ctx.next = 6;
      break;
    case 6:
      baz = function baz(i) {
        var j;
        var $ctx = baz.$ctx;
        $ctx.isCompiled = true;

        if ($ctx.frame) {
          i = $ctx.frame.scope.i;
          j = $ctx.frame.scope.j;
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
            }
          } else {
            if ($ctx.staticBreakpoint)
              $ctx.next = $ctx.next + 3;

            $ctx.frame = null;
            $ctx.childFrame = null;
          }
        }

        while (1) {
          if (VM.hasBreakpoints && VM.machineBreaks[3][$ctx.next] !== undefined)
            break;

          switch ($ctx.next) {
          case 0:
            j = 10;
            $ctx.next = 3;
            break;
          case 3:
            j = 5;
            $ctx.next = 6;
            break;
          case 6:
            i--;
            $ctx.next = 9;
            break;
          case 9:
            if (i > 0) {
              $ctx.next = 3;
              break;
            }
          case 10:
            var $t5 = mumble.$ctx = VM.getContext();
            $t5.softReset();
            var $t6 = mumble(j);
            $ctx.next = 18;

            if ($t5.frame) {
              $ctx.childFrame = $t5.frame;
              $ctx.resultLoc = "t4";
              VM.stepping = true;
              break;
            }

            $ctx.t4 = ($t5.isCompiled ? $t5.rval : $t6);
            VM.releaseContext();
            break;
          case 18:
            $ctx.rval = $ctx.t4;
            delete $ctx.thrown;
            $ctx.next = 22;
            break;
          case 22:
            return $ctx.stop();
          }

          if (VM.stepping)
            break;
        }

        $ctx.frame = new VM.Frame(3, "baz", baz, {
          "i": i,
          "j": j
        }, this, $ctx, $ctx.childFrame);
      };

      $ctx.next = 9;
      break;
    case 9:
      bar = function bar(i) {
        var $ctx = bar.$ctx;
        $ctx.isCompiled = true;

        if ($ctx.frame) {
          i = $ctx.frame.scope.i;
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
            }
          } else {
            if ($ctx.staticBreakpoint)
              $ctx.next = $ctx.next + 3;

            $ctx.frame = null;
            $ctx.childFrame = null;
          }
        }

        while (1) {
          if (VM.hasBreakpoints && VM.machineBreaks[4][$ctx.next] !== undefined)
            break;

          switch ($ctx.next) {
          case 0:
            if (!(i > 0)) {
              $ctx.next = 26;
              break;
            }

            $ctx.next = 3;
            break;
          case 3:
            var $t8 = baz.$ctx = VM.getContext();
            $t8.softReset();
            var $t9 = baz(i);
            $ctx.next = 11;

            if ($t8.frame) {
              $ctx.childFrame = $t8.frame;
              $ctx.resultLoc = "t7";
              VM.stepping = true;
              break;
            }

            $ctx.t7 = ($t8.isCompiled ? $t8.rval : $t9);
            VM.releaseContext();
            break;
          case 11:
            $ctx.t12 = i - 1;
            $ctx.next = 14;
            break;
          case 14:
            var $t11 = bar.$ctx = VM.getContext();
            $t11.softReset();
            var $t13 = bar($ctx.t12);
            $ctx.next = 22;

            if ($t11.frame) {
              $ctx.childFrame = $t11.frame;
              $ctx.resultLoc = "t10";
              VM.stepping = true;
              break;
            }

            $ctx.t10 = ($t11.isCompiled ? $t11.rval : $t13);
            VM.releaseContext();
            break;
          case 22:
            $ctx.rval = $ctx.t7 + $ctx.t10;
            delete $ctx.thrown;
            $ctx.next = 30;
            break;
          case 26:
            $ctx.rval = 100;
            delete $ctx.thrown;
            $ctx.next = 30;
            break;
          case 30:
            return $ctx.stop();
          }

          if (VM.stepping)
            break;
        }

        $ctx.frame = new VM.Frame(4, "bar", bar, {
          "i": i
        }, this, $ctx, $ctx.childFrame);
      };

      $ctx.next = 12;
      break;
    case 12:
      foo = function foo() {
        var $ctx = foo.$ctx;
        $ctx.isCompiled = true;

        if ($ctx.frame) {
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
            }
          } else {
            if ($ctx.staticBreakpoint)
              $ctx.next = $ctx.next + 3;

            $ctx.frame = null;
            $ctx.childFrame = null;
          }
        }

        while (1) {
          if (VM.hasBreakpoints && VM.machineBreaks[5][$ctx.next] !== undefined)
            break;

          switch ($ctx.next) {
          case 0:
            var $t15 = bar.$ctx = VM.getContext();
            $t15.softReset();
            var $t16 = bar(2000);
            $ctx.next = 8;

            if ($t15.frame) {
              $ctx.childFrame = $t15.frame;
              $ctx.resultLoc = "t14";
              VM.stepping = true;
              break;
            }

            $ctx.t14 = ($t15.isCompiled ? $t15.rval : $t16);
            VM.releaseContext();
            break;
          case 8:
            $ctx.rval = $ctx.t14;
            delete $ctx.thrown;
            $ctx.next = 12;
            break;
          case 12:
            return $ctx.stop();
          }

          if (VM.stepping)
            break;
        }

        $ctx.frame = new VM.Frame(5, "foo", foo, {}, this, $ctx, $ctx.childFrame);
      };

      $ctx.next = 15;
      break;
    case 15:
      var $t20 = foo.$ctx = VM.getContext();
      $t20.softReset();
      var $t21 = foo();
      $ctx.next = 23;

      if ($t20.frame) {
        $ctx.childFrame = $t20.frame;
        $ctx.resultLoc = "t19";
        VM.stepping = true;
        break;
      }

      $ctx.t19 = ($t20.isCompiled ? $t20.rval : $t21);
      VM.releaseContext();
      break;
    case 23:
      var $t18 = console.log.$ctx = VM.getContext();
      $t18.softReset();
      var $t22 = console.log($ctx.t19);
      $ctx.next = 31;

      if ($t18.frame) {
        $ctx.childFrame = $t18.frame;
        $ctx.resultLoc = "t17";
        VM.stepping = true;
        break;
      }

      $ctx.t17 = ($t18.isCompiled ? $t18.rval : $t22);
      VM.releaseContext();
      break;
    case 31:
      return $ctx.stop();
    }

    if (VM.stepping)
      break;
  }

  $ctx.frame = new VM.Frame(0, "$anon1", $anon1, {
    "quux": quux,
    "mumble": mumble,
    "baz": baz,
    "bar": bar,
    "foo": foo
  }, this, $ctx, $ctx.childFrame);
});
