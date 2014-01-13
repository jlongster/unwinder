(function(global) {
  var hasOwn = Object.prototype.hasOwnProperty;

  // vm

  var findingRoot = false;

  function invokeRoot(fn, self) {
    findingRoot = true;
    rootFrame = curFrame = fn();
    findingRoot = false;

    rootFrame.run();
  }

  function invokeFunction(name, id, fn, self) {
    var frame = new Frame(name, id, fn, self);

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
    VM.state = VM.IDLE;
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

  VM.IDLE = 'idle';
  VM.SUSPENDED = 'suspended';
  VM.EXECUTING = 'executing';

  function Frame(name, machineId, fn, self) {
    var context = new Context();
    this.self = self;
    this.fn = fn;
    this.name = name;
    this.machineId = machineId;

    var savedNext = null;

    this.run = function() {
      VM.state = VM.EXECUTING;
      context.state = 'executing';

      while(VM.state === VM.EXECUTING) {
        curFrame.invoke();
      }
    };

    this.invoke = function() {
      var prevState = VM.state;
      savedNext = context.next;
      fn.call(self, context);

      if(context.done && !this.parent) {
        VM.reset();
      }
      else if(context.invoke) {
        var frame = context.invoke;
        context.invoke = null;

        if(frame instanceof Frame) {
          frame.parent = this;
          curFrame = frame;
          curFrame.setState(context.state);
        }
        else {
          // if it's not a frame, then a function was called
          // that is not compiled for us. go ahead and just
          // give the value back to the context and continue.
          this.return(frame);
        }
      }
      else if(context.rval !== UndefinedValue) {
        // something was returned
        var val = context.rval;
        context.rval = UndefinedValue;
        curFrame = this.parent;
        curFrame.return(val);
      }
      else if(!context.done && context.state === 'suspended') {
        VM.state = VM.SUSPENDED;
      }

      if(curFrame === rootFrame &&
         !context.done &&
         context.next === this.getFinalLoc()) {
        // jump to the final location and end the program,
        // regardless of any stepping
        this.invoke();
      }
      else if(VM.state === VM.SUSPENDED) {
        if(prevState !== VM.state) {
          VM.onBreakpoint && VM.onBreakpoint();
        }
        else {
          VM.onStep && VM.onStep();
        }
      }
      else if(VM.state === VM.IDLE && VM.onFinish) {
        VM.onFinish();
      }
    };

    this.step = function() {
      curFrame.invoke();
    };

    this.return = function(val) {
      context.returned = val;
    };

    this.evaluate = function(expr) {
      var savedLoc = context.next;
      var evalLoc = this.getEvalLoc();

      if(!evalLoc) {
        throw new Error("cannot eval: debug information not available");
      }

      context.next = evalLoc;
      try {
        var ret = fn.call(self, context, expr);
      }
      finally {
        context.next = savedLoc;
      }

      return ret;
    };

    this.setState = function(state) {
      context.state = state;
    };

    this.getStack = function() {
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

    this.getLoc = function() {
      return debugInfo[this.machineId].locs[context.next];
    };

    this.getSavedLoc = function() {
      return debugInfo[this.machineId].locs[savedNext];
    };

    this.getFinalLoc = function() {
      return debugInfo[this.machineId].finalLoc;
    };

    this.getEvalLoc = function() {
      return debugInfo[this.machineId].evalLoc;
    };

    this.getExpression = function() {
      //console.log(this.machineId, context.debugIdx || context.next);

      var loc = this.getLoc();
      if(loc && originalSrc) {
        var line = originalSrc[loc.start.line - 1];
        return line.slice(loc.start.column, loc.end.column);
      }
    };
  }

  function Context() {
    this.reset();
  }

  Context.prototype = {
    constructor: Context,

    reset: function() {
      this.next = 0;
      this.sent = void 0;
      this.state = 'executing';
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
