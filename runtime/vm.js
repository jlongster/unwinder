(function(global) {
  var hasOwn = Object.prototype.hasOwnProperty;

  // cache

  var _frames = [];
  var frameptr = 0;
  for(var i=0; i<100000; i++) {
    _frames.push(new Frame());
  }

  function getFrame() {
    return _frames[frameptr++];
  }

  function releaseFrame() {
    frameptr--;
  }

  // vm

  var findingRoot = false;

  function invokeRoot(fn, self) {
    fn.$ctx = new Context();

    var frame = getFrame();
    frame.fn = fn;
    frame.context = fn.$ctx;
    frame.invokeMeta = ['top-level', null, fn];
    frame.name = frame.invokeMeta[0];
    frame.machineId = fn.$machineId;
    frame.savedNext = null;
    frame.parent = null;

    rootFrame = curFrame = frame;
    rootFrame.run();
  }

  function invokeFunction(name, id, fn, self) {
    var frame = getFrame();
    frame.context = new Context();
    frame.fn = fn;
    frame.name = name;
    frame.machineId = id;
    frame.savedNext = null;

    if(!rootFrame && !findingRoot) {
      // no root frame means that it's being called from outside
      // our control, most likely something async. simply make
      // this the root frame!! this makes ALL FUNCTIONS
      // INTEROPERABLE! without having to shim anything. we
      // could even have hooks for when async is entered/exited
      // and create neat debugging tools for that.

      rootFrame = curFrame = frame;
      rootFrame.run();
    }
    else {
      return frame;
    }
  }

  global.invokeFunction = invokeFunction;
  global.invokeRoot = invokeRoot;
  var VM = global.VM = {};

  if(typeof exports !== 'undefined') {
    exports.invokeFunction = invokeFunction;
    exports.invokeRoot = invokeRoot;
  }

  var originalSrc;
  var debugInfo;

  VM.setDebugInfo = function(info) {
    debugInfo = info;
  };

  VM.getLoc = function() {
    return curFrame && curFrame.getLoc();
  };

  VM.getCurrentFrame = function() {
    return curFrame;
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
    }
  };

  var UndefinedValue = Object.create(null);
  var rootFrame;
  var curFrame;
  var lastEval;

  // Be aware: getDispatchLoop in emit.js hardcodes the value 3 to
  // represent VM.EXECUTING
  var IDLE = VM.IDLE = 1;
  var SUSPENDED = VM.SUSPENDED = 2;
  var EXECUTING = VM.EXECUTING = 3;

  function Frame() {
  }

  // function Frame(name, machineId, fn, self) {
  // }

  Frame.prototype.run = function() {
    VM.state = EXECUTING;
    this.context.state = EXECUTING;

    while(VM.state === EXECUTING) {
      curFrame.invoke();
    }
  };

  Frame.prototype.invoke = function() {
    var context = this.context;
    var prevState = VM.state;
    var fn = this.fn;
    var invokeMeta = this.invokeMeta;
    this.savedNext = context.next;

    // Call the function
    //
    // Hard-code a lot of special cases for good performance.
    // `invokeMeta` is an array containing call information with the
    // following indexes:
    // 0: function name
    // 1: `this` context
    // 2: function instance
    // 3-n: arguments

    var thisCtx = invokeMeta[1];
    var nargs = invokeMeta.length - 3;
    var res;

    if(thisCtx) {
      switch(nargs) {
      case 0:
        res = fn.call(thisCtx); break;
      case 1:
        res = fn.call(thisCtx, invokeMeta[3]); break;
      case 2:
        res = fn.call(thisCtx, invokeMeta[3], invokeMeta[4]); break;
      default:
        res = fn.apply(thisCtx, invokeMeta.slice(3));
      }
    }
    else {
      switch(nargs) {
      case 0:
        res = fn(); break;
      case 1:
        res = fn(target[3]); break;
      case 2:
        res = fn(target[3], target[4]); break;
      default:
        res = fn.apply(null, target.slice(3));
      }
    }

    // Handle the current state

    if(context.done && !this.parent) {
      VM.reset();
    }
    else if(context.invoke) {
      var meta = context.invoke;
      context.invoke = null;

      var fnInst = meta[2];
      fnInst.$ctx = new Context();

      var frame = getFrame();
      frame.fn = fnInst;
      frame.context = fn.$ctx;
      frame.invokeMeta = meta;
      frame.name = meta[0];
      frame.machineId = fn.$machineId;
      frame.savedNext = null;

      frame.parent = this;
      curFrame = frame;
      curFrame.setState(context.state);
    }
    else if(context.rval !== UndefinedValue) {
      // something was returned
      var val = context.rval;
      context.rval = UndefinedValue;
      curFrame = this.parent;
      curFrame.return(val);
      releaseFrame();
    }
    else if(!context.isCompiled) {
      // we called a native function that wasn't compiled by us, so it
      // just returned a value like normal
      curFrame.return(res);
      releaseFrame();
    }
    else if(!context.done && context.state === SUSPENDED) {
      VM.state = VM.SUSPENDED;
    }

    if(VM.state === SUSPENDED) {
      if(curFrame === rootFrame &&
         !context.done &&
         context.next === this.getFinalLoc()) {
        // jump to the final location and end the program,
        // regardless of any stepping
        this.invoke();
        return;
      }

      if(prevState !== VM.state) {
        VM.onBreakpoint && VM.onBreakpoint();
      }
      else {
        VM.onStep && VM.onStep();
      }
    }
    else if(VM.state === IDLE && VM.onFinish) {
      VM.onFinish();
    }
  };

  Frame.prototype.step = function() {
    curFrame.invoke();
  };

  Frame.prototype.return = function(val) {
    this.context.returned = val;
  };

  Frame.prototype.evaluate = function(expr) {
    var savedLoc = this.context.next;
    var evalLoc = this.getEvalLoc();

    if(!evalLoc) {
      throw new Error("cannot eval: debug information not available");
    }

    this.context.next = evalLoc;
    try {
      var ret = fn.call(self, this.context, expr);
    }
    finally {
      this.context.next = savedLoc;
    }

    return ret;
  };

  Frame.prototype.setState = function(state) {
    this.context.state = state;
  };

  Frame.prototype.getStack = function() {
    if(this.parent) {
      var frame = this.parent;
      var stack = [[this.name, this.getLoc()]];

      while(frame.parent) {
        stack.push([frame.name, frame.getSavedLoc()]);
        frame = frame.parent;
      }

      return stack.reverse();
    }
    else {
      return [];
    }
  };

  Frame.prototype.getLoc = function() {
    return debugInfo[this.machineId].locs[this.context.next];
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

    reset: function() {
      this.next = 0;
      this.sent = void 0;
      this.returned = void 0;
      this.state = EXECUTING;
      this.rval = UndefinedValue;
      this.tryStack = [];
      this.done = false;
      this.delegate = null;

      // Pre-initialize at least 20 temporary variables to enable hidden
      // class optimizations for simple generators.
      for (var tempIndex = 0, tempName;
           hasOwn.call(this, tempName = "t" + tempIndex) || tempIndex < 20;
           ++tempIndex) {
        this[tempName] = null;
      }
    },

    stop: function() {
      this.done = true;

      if (hasOwn.call(this, "thrown")) {
        var thrown = this.thrown;
        delete this.thrown;
        throw thrown;
      }

      if(this.rval === UndefinedValue) {
        this.rval = undefined;
      }
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
}).call(this, (function() { return this; })());
