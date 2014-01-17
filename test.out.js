
__debug_sourceURL="test3.js";
(function(global) {
  var hasOwn = Object.prototype.hasOwnProperty;

  // vm

  var findingRoot = false;

  function invokeRoot(fn) {
    // hack: if there's no debug info, there's no client connected to
    // this running instance (which could be invoked from an async
    // event like setTimeout). ignore it.
    if(!debugInfo) {
      return;
    }

    VM.state = EXECUTING;

    var ctx = fn.$ctx = getContext();
    ctx.softReset();
    fn();
    checkStatus(ctx);

    // clean up the function, since this property is used to tell if
    // we are inside our VM or not
    delete fn.$ctx;
  }

  function checkStatus(ctx) {
    if(ctx.frame) {
      // machine was paused
      VM.state = VM.SUSPENDED;
      rootFrame = ctx.frame;
      rootFrame.name = 'top-level';

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

    if(i > count) {
      return null;
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

  VM.stepOver = function() {
    if(!rootFrame) return;
    var top = VM.getTopFrame();
    var curloc = VM.getLocation();
    var finalLoc = curloc;
    var biggest = 0;
    var locs = debugInfo[top.machineId].locs;

    // find the "biggest" expression in the function that encloses
    // this one
    Object.keys(locs).forEach(function(k) {
      var loc = locs[k];

      if(loc.start.line <= curloc.start.line &&
         loc.end.line >= curloc.end.line &&
         loc.start.column <= curloc.start.column &&
         loc.end.column >= curloc.end.column) {

        var ldiff = ((curloc.start.line - loc.start.line) +
                     (loc.end.line - curloc.end.line));
        var cdiff = ((curloc.start.column - loc.start.column) +
                     (loc.end.column - curloc.end.column));
        if(ldiff + cdiff > biggest) {
          finalLoc = loc;
          biggest = ldiff + cdiff;
        }
      }
    });

    if(finalLoc !== curloc) {
      while(VM.getLocation() !== finalLoc) {
        VM.step();
      }

      VM.step();
    }
    else {
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

      // fix the self-referencing pointer
      res.frame.ctx.frame = res.frame;

      // switch frames to get any updated data
      var parent = VM.getFrameOffset(1);
      if(parent) {
        parent.child = res.frame;
      }
      else {
        rootFrame = res.frame;
      }

      rootFrame.name = 'top-level';
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
    if(!rootFrame || !debugInfo) return;

    var top = VM.getTopFrame();
    return debugInfo[top.machineId].locs[top.ctx.next];
  };

  VM.disableBreakpoints = function() {
    VM.hasBreakpoints = false;
  };

  VM.enableBreakpoints = function() {
    VM.hasBreakpoints = true;
  };

  VM.removeBreakpoints = function() {
    // this will reset the interal breakpoint arrays
    VM.setDebugInfo(debugInfo);
  };

  VM.toggleBreakpoint = function(line) {
    _toggleBreakpoint(VM.lineToMachinePos(line));
  };

  function _toggleBreakpoint(pos) {
    if(!pos) return;

    var machineId = pos.machineId;
    var locId = pos.locId;

    if(VM.machineBreaks[machineId][locId] === undefined) {
      VM.hasBreakpoints = true;
      VM.machineBreaks[pos.machineId][pos.locId] = true;
    }
    else {
      VM.machineBreaks[pos.machineId][pos.locId] = undefined;
    }

    return true;
  };

  VM.lineToMachinePos = function(line) {
    if(!debugInfo) return null;

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

    "24": {
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
  "finalLoc": 30,

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

    "26": {
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
  "finalLoc": 25,

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

    "12": {
      "start": {
        "line": 26,
        "column": 9
      },

      "end": {
        "line": 26,
        "column": 18
      }
    },

    "21": {
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
  "finalLoc": 32,

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

    "12": {
      "start": {
        "line": 31,
        "column": 24
      },

      "end": {
        "line": 31,
        "column": 29
      }
    },

    "15": {
      "start": {
        "line": 31,
        "column": 20
      },

      "end": {
        "line": 31,
        "column": 30
      }
    },

    "24": {
      "start": {
        "line": 31,
        "column": 4
      },

      "end": {
        "line": 31,
        "column": 31
      }
    },

    "28": {
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
  "finalLoc": 13,

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

    "9": {
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

VM.invokeRoot(function $anon1() {
  var quux, mumble, baz, bar, foo;
  var $ctx = $anon1.$ctx;

  if ($ctx === undefined)
    return VM.invokeRoot($anon1);

  $ctx.isCompiled = true;

  try {
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
        quux = function quux(i) {
          var z, obj, k;
          var $ctx = quux.$ctx;

          if ($ctx === undefined)
            return VM.invokeRoot(quux);

          $ctx.isCompiled = true;

          try {
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
                $ctx.t6 = $ctx.keys(obj);
              case 7:
                if (!$ctx.t6.length) {
                  $ctx.next = 16;
                  break;
                }

                k = $ctx.t6.pop();
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
                quux.$ctx = undefined;
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

          $ctx.frame = new VM.Frame(1, "quux", quux, {
            "i": i,
            "z": z,
            "obj": obj,
            "k": k
          }, ["quux", "mumble", "baz", "bar", "foo"], this, $ctx, $ctx.childFrame);

          quux.$ctx = undefined;
        };

        $ctx.next = 3;
        break;
      case 3:
        mumble = function mumble(i) {
          var z, j;
          var $ctx = mumble.$ctx;

          if ($ctx === undefined)
            return VM.invokeRoot(mumble);

          $ctx.isCompiled = true;

          try {
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
                var $t8 = VM.getContext();

                if (quux)
                  quux.$ctx = $t8;

                $t8.softReset();
                var $t9 = quux(z);
                $ctx.next = 26;

                if ($t8.frame) {
                  $ctx.childFrame = $t8.frame;
                  $ctx.resultLoc = "t7";
                  VM.stepping = true;
                  break;
                }

                $ctx.t7 = ($t8.isCompiled ? $t8.rval : $t9);
                VM.releaseContext();
                break;
              case 26:
                $ctx.rval = $ctx.t7;
                delete $ctx.thrown;
                $ctx.next = 30;
                break;
              case 30:
                mumble.$ctx = undefined;
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

          $ctx.frame = new VM.Frame(2, "mumble", mumble, {
            "i": i,
            "z": z,
            "j": j
          }, ["quux", "mumble", "baz", "bar", "foo"], this, $ctx, $ctx.childFrame);

          mumble.$ctx = undefined;
        };

        $ctx.next = 6;
        break;
      case 6:
        baz = function baz(i) {
          var j;
          var $ctx = baz.$ctx;

          if ($ctx === undefined)
            return VM.invokeRoot(baz);

          $ctx.isCompiled = true;

          try {
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

                $ctx.next = 12;
                break;
              case 12:
                var $t11 = VM.getContext();

                if (mumble)
                  mumble.$ctx = $t11;

                $t11.softReset();
                var $t12 = mumble(j);
                $ctx.next = 21;

                if ($t11.frame) {
                  $ctx.childFrame = $t11.frame;
                  $ctx.resultLoc = "t10";
                  VM.stepping = true;
                  break;
                }

                $ctx.t10 = ($t11.isCompiled ? $t11.rval : $t12);
                VM.releaseContext();
                break;
              case 21:
                $ctx.rval = $ctx.t10;
                delete $ctx.thrown;
                $ctx.next = 25;
                break;
              case 25:
                baz.$ctx = undefined;
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

          $ctx.frame = new VM.Frame(3, "baz", baz, {
            "i": i,
            "j": j
          }, ["quux", "mumble", "baz", "bar", "foo"], this, $ctx, $ctx.childFrame);

          baz.$ctx = undefined;
        };

        $ctx.next = 9;
        break;
      case 9:
        bar = function bar(i) {
          var $ctx = bar.$ctx;

          if ($ctx === undefined)
            return VM.invokeRoot(bar);

          $ctx.isCompiled = true;

          try {
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
              if (VM.hasBreakpoints && VM.machineBreaks[4][$ctx.next] !== undefined)
                break;

              switch ($ctx.next) {
              case 0:
                if (!(i > 0)) {
                  $ctx.next = 28;
                  break;
                }

                $ctx.next = 3;
                break;
              case 3:
                var $t14 = VM.getContext();

                if (baz)
                  baz.$ctx = $t14;

                $t14.softReset();
                var $t15 = baz(i);
                $ctx.next = 12;

                if ($t14.frame) {
                  $ctx.childFrame = $t14.frame;
                  $ctx.resultLoc = "t13";
                  VM.stepping = true;
                  break;
                }

                $ctx.t13 = ($t14.isCompiled ? $t14.rval : $t15);
                VM.releaseContext();
                break;
              case 12:
                $ctx.t18 = i - 1;
                $ctx.next = 15;
                break;
              case 15:
                var $t17 = VM.getContext();

                if (bar)
                  bar.$ctx = $t17;

                $t17.softReset();
                var $t19 = bar($ctx.t18);
                $ctx.next = 24;

                if ($t17.frame) {
                  $ctx.childFrame = $t17.frame;
                  $ctx.resultLoc = "t16";
                  VM.stepping = true;
                  break;
                }

                $ctx.t16 = ($t17.isCompiled ? $t17.rval : $t19);
                VM.releaseContext();
                break;
              case 24:
                $ctx.rval = $ctx.t13 + $ctx.t16;
                delete $ctx.thrown;
                $ctx.next = 32;
                break;
              case 28:
                $ctx.rval = 100;
                delete $ctx.thrown;
                $ctx.next = 32;
                break;
              case 32:
                bar.$ctx = undefined;
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

          $ctx.frame = new VM.Frame(4, "bar", bar, {
            "i": i
          }, ["quux", "mumble", "baz", "bar", "foo"], this, $ctx, $ctx.childFrame);

          bar.$ctx = undefined;
        };

        $ctx.next = 12;
        break;
      case 12:
        foo = function foo() {
          var $ctx = foo.$ctx;

          if ($ctx === undefined)
            return VM.invokeRoot(foo);

          $ctx.isCompiled = true;

          try {
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
              if (VM.hasBreakpoints && VM.machineBreaks[5][$ctx.next] !== undefined)
                break;

              switch ($ctx.next) {
              case 0:
                var $t21 = VM.getContext();

                if (bar)
                  bar.$ctx = $t21;

                $t21.softReset();
                var $t22 = bar(10000);
                $ctx.next = 9;

                if ($t21.frame) {
                  $ctx.childFrame = $t21.frame;
                  $ctx.resultLoc = "t20";
                  VM.stepping = true;
                  break;
                }

                $ctx.t20 = ($t21.isCompiled ? $t21.rval : $t22);
                VM.releaseContext();
                break;
              case 9:
                $ctx.rval = $ctx.t20;
                delete $ctx.thrown;
                $ctx.next = 13;
                break;
              case 13:
                foo.$ctx = undefined;
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

          $ctx.frame = new VM.Frame(5, "foo", foo, {}, ["quux", "mumble", "baz", "bar", "foo"], this, $ctx, $ctx.childFrame);
          foo.$ctx = undefined;
        };

        $ctx.next = 15;
        break;
      case 15:
        var $t3 = VM.getContext();

        if (foo)
          foo.$ctx = $t3;

        $t3.softReset();
        var $t4 = foo();
        $ctx.next = 24;

        if ($t3.frame) {
          $ctx.childFrame = $t3.frame;
          $ctx.resultLoc = "t2";
          VM.stepping = true;
          break;
        }

        $ctx.t2 = ($t3.isCompiled ? $t3.rval : $t4);
        VM.releaseContext();
        break;
      case 24:
        var $t1 = VM.getContext();

        if (console.log)
          console.log.$ctx = $t1;

        $t1.softReset();
        var $t5 = console.log($ctx.t2);
        $ctx.next = 33;

        if ($t1.frame) {
          $ctx.childFrame = $t1.frame;
          $ctx.resultLoc = "t0";
          VM.stepping = true;
          break;
        }

        $ctx.t0 = ($t1.isCompiled ? $t1.rval : $t5);
        VM.releaseContext();
        break;
      case 33:
        $anon1.$ctx = undefined;
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
    "quux": quux,
    "mumble": mumble,
    "baz": baz,
    "bar": bar,
    "foo": foo
  }, [], this, $ctx, $ctx.childFrame);

  $anon1.$ctx = undefined;
}, this);
