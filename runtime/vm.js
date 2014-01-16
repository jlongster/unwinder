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
