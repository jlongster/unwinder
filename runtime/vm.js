
(function(global) {
  var hasOwn = Object.prototype.hasOwnProperty;

  // since eval is used, need access to the compiler

  if(typeof module !== 'undefined') {
    var compiler = require('../main.js');
  }
  else {
    var compiler = main.js;
  }

  // vm

  var IDLE = 'idle';
  var SUSPENDED = 'suspended';
  var EXECUTING = 'executing';

  function Machine() {
    this.debugInfo = null;
    this.rootFrame = null;
    this.lastEval = null;
    this.state = IDLE;
    this._events = {};
    this.stepping = false;
    this.prevStates = [];
    this.allocCache();
    this.tryStack = [];
  }

  // 3 ways to execute code:
  //
  // * run: the main entry point. give it a string and it will being the program
  // * execute: runs a function instance. use this to run individual
  //   state machines
  // * evaluate: evalutes a code string in the global scope

  Machine.prototype.execute = function(fn, debugInfo, thisPtr, args) {
    var prevState = this.state;
    this.state = EXECUTING;

    if(debugInfo) {
      if(!debugInfo.data) {
        debugInfo = new DebugInfo(debugInfo);
      }
      this.setDebugInfo(debugInfo);
    }

    var prevStepping = this.stepping;
    var prevFrame = this.rootFrame;
    this.stepping = false;

    var ctx = fn.$ctx = this.getContext();
    ctx.softReset();
    if(thisPtr || args) {
      fn.apply(thisPtr, args || []);
    }
    else {
      fn();
    }

    // It's a weird case if we run code while we are suspended, but if
    // so we try to run it and kind of ignore whatever happened (no
    // breakpoints, etc), but we do fire an error event if it happened
    if(prevState === 'suspended') {
      if(this.error) {
        this.fire('error', this.error);
        this.error = null;
      }
      this.state = prevState;
    }
    else {
      this.rootFrame = null;
      this.checkStatus(ctx);
    }

    this.stepping = prevStepping;

    return ctx.rval;
  };

  Machine.prototype.run = function(code, debugInfo) {
    if(typeof code === 'string') {
      var fn = new Function('VM', '$Frame', code + '\nreturn $__global;');
      var rootFn = fn(this, Frame);
    }
    else {
      var rootFn = code;
    }

    this.execute(rootFn, debugInfo);
    this.globalFn = rootFn;
  };

  Machine.prototype.continue = function() {
    if(this.rootFrame && this.state === SUSPENDED) {
      var top = this.getTopFrame();
      if(!top.ctx.staticBreakpoint) {
        // We need to get past this instruction that has a breakpoint, so
        // turn off breakpoints and step past it, then turn them back on
        // again and execute normally
        this.stepping = true;
        this.hasBreakpoints = false;
        this.rootFrame.restore();
      }

      var nextFrame = this.rootFrame.ctx.frame;
      this.hasBreakpoints = true;
      this.stepping = false;
      nextFrame.restore();
      this.rootFrame = null;
      this.checkStatus(nextFrame.ctx);
    }
  };

  Machine.prototype.step = function() {
    if(!this.rootFrame) return;

    this.stepping = true;
    this.hasBreakpoints = false;
    this.rootFrame.restore();
    this.hasBreakpoints = true;

    this.checkStatus(this.rootFrame.ctx);

    // rootFrame now points to the new stack
    var top = this.getTopFrame(this.rootFrame);

    if(this.state === SUSPENDED &&
       top.ctx.next === this.debugInfo.data[top.machineId].finalLoc) {
      // if it's waiting to simply return a value, go ahead and run
      // that step so the user doesn't have to step through each frame
      // return
      this.step();
    }
  };

  Machine.prototype.stepOver = function() {
    if(!this.rootFrame) return;
    var top = this.getTopFrame();
    var curloc = this.getLocation();
    var finalLoc = curloc;
    var biggest = 0;
    var locs = this.debugInfo.data[top.machineId].locs;

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
      while(this.getLocation() !== finalLoc) {
        this.step();
      }

      this.step();
    }
    else {
      this.step();
    }
  };

  Machine.prototype.evaluate = function(expr) {
    if(expr === '$_') {
      return this.lastEval;
    }

    // An expression can be one of these forms:
    //
    // 1. foo = function() { <stmt/expr> ... }
    // 2. function foo() { <stmt/expr> ... }
    // 3. x = <expr>
    // 4. var x = <expr>
    // 5. <stmt/expr>
    //
    // 1-4 can change any data in the current frame, and introduce new
    // variables that are only available for the current session (will
    // disappear after any stepping/resume/etc). Functions in 1 and 2
    // will be compiled, so they can be paused and debugged.
    //
    // 5 can run any arbitrary expression, TODO: but there might be
    // implications of running it raw

    if(this.rootFrame) {
      var top = this.getTopFrame();
      expr = compiler(expr, {
        asExpr: true,
        scope: top.scope
      }).code;

      var res = top.evaluate(this, expr);

      // fix the self-referencing pointer
      res.frame.ctx.frame = res.frame;

      // switch frames to get any updated data
      var parent = this.getFrameOffset(1);
      if(parent) {
        parent.child = res.frame;
      }
      else {
        this.rootFrame = res.frame;
      }

      this.lastEval = res.result;
      return this.lastEval;
    }
    else if(this.globalFn) {
      expr = compiler(expr, {
        asExpr: true
      }).code;

      this.evalArg = expr;
      this.stepping = true;

      var ctx = this.getContext();
      ctx.softReset();
      ctx.next = -1;
      ctx.frame = true;

      this.globalFn.$ctx = ctx;
      (0, this).globalFn();

      return ctx.rval;
    }
  };

  Machine.prototype.checkStatus = function(ctx) {
    if(ctx.frame) {
      this.rootFrame = ctx.frame;

      if(this.dispatchException(this.error)) {
        this.rootFrame = null;
        return;
      }

      // machine was paused
      this.state = SUSPENDED;

      if(this.error) {
        this.fire('error', this.error);
        this.error = null;
      }
      else {
        this.fire('breakpoint');
      }

      this.stepping = true;
    }
    else {
      this.fire('finish');
      this.state = IDLE;
    }
  };

  Machine.prototype.on = function(event, handler) {
    var arr = this._events[event] || [];
    arr.push(handler);
    this._events[event] = arr;
  };

  Machine.prototype.off = function(event, handler) {
    var arr = this._events[event] || [];
    if(handler) {
      var i = arr.indexOf(handler);
      if(i !== -1) {
        arr.splice(i, 1);
      }
    }
    else {
      this._events[event] = [];
    }
  };

  Machine.prototype.fire = function(event, data) {
    // Events are always fired asynchronouly
    setTimeout(function() {
      var arr = this._events[event] || [];
      arr.forEach(function(handler) {
        handler(data);
      });
    }.bind(this), 0);
  };

  Machine.prototype.getTopFrame = function() {
    if(!this.rootFrame) return null;

    var top = this.rootFrame;
    while(top.child) {
      top = top.child;
    }
    return top;
  };

  Machine.prototype.getRootFrame = function() {
    return this.rootFrame;
  };

  Machine.prototype.getFrameOffset = function(i) {
    // TODO: this is really annoying, but it works for now. have to do
    // two passes
    var top = this.rootFrame;
    var count = 0;
    while(top.child) {
      top = top.child;
      count++;
    }

    if(i > count) {
      return null;
    }

    var depth = count - i;
    top = this.rootFrame;
    count = 0;
    while(top.child && count < depth) {
      top = top.child;
      count++;
    }

    return top;
  };

  Machine.prototype.getFrames = function() {
    var frames = [];
    var frame = this.rootFrame;
    while(frame) {
      frames.push(frame);
      frame = frame.child;
    }
    return frames;
  };

  Machine.prototype.setDebugInfo = function(info) {
    this.debugInfo = info || new DebugInfo([]);
    this.machineBreaks = new Array(this.debugInfo.data.length);

    for(var i=0; i<this.debugInfo.data.length; i++) {
      this.machineBreaks[i] = [];
    }

    this.debugInfo.breakpoints.forEach(function(line) {
      var pos = info.lineToMachinePos(line);
      if(!pos) return;

      var machineId = pos.machineId;
      var locId = pos.locId;

      if(this.machineBreaks[machineId][locId] === undefined) {
        this.hasBreakpoints = true;
        this.machineBreaks[pos.machineId][pos.locId] = true;
      }
    }.bind(this));
  };

  Machine.prototype.isStepping = function() {
    return this.stepping;
  };

  Machine.prototype.getState = function() {
    return this.state;
  };

  Machine.prototype.getLocation = function() {
    if(!this.rootFrame || !this.debugInfo) return;

    var top = this.getTopFrame();
    return this.debugInfo.data[top.machineId].locs[top.ctx.next];
  };

  Machine.prototype.disableBreakpoints = function() {
    this.hasBreakpoints = false;
  };

  Machine.prototype.enableBreakpoints = function() {
    this.hasBreakpoints = true;
  };

  // cache

  Machine.prototype.allocCache = function() {
    this.cacheSize = 15000;
    this._contexts = new Array(this.cacheSize);
    this.contextptr = 0;
    for(var i=0; i<this.cacheSize; i++) {
      this._contexts[i] = new Context();
    }
  };

  Machine.prototype.getContext = function() {
    var ctx;
    if(this.contextptr < this.cacheSize) {
      ctx = this._contexts[this.contextptr];
    }
    else {
      ctx = new Context();
    }

    this.contextptr++;
    ctx.softReset();
    return ctx;
  };

  Machine.prototype.releaseContext = function() {
    this.contextptr--;
  };

  Machine.prototype.pushState = function() {
    this.prevStates.push([
      this.stepping, this.hasBreakpoints
    ]);

    this.stepping = false;
    this.hasBreakpoints = false;
  };

  Machine.prototype.popState = function() {
    var state = this.prevStates.pop();
    this.stepping = state[0];
    this.hasBreakpoints = state[1];
  };

  Machine.prototype.pushTry = function(stack, catchLoc, finallyLoc, finallyTempVar) {
    if(finallyLoc) {
      stack.push({
        finallyLoc: finallyLoc,
        finallyTempVar: finallyTempVar
      });
    }

    if(catchLoc) {
      stack.push({
        catchLoc: catchLoc
      });
    }
  };

  Machine.prototype.popCatch = function(stack, catchLoc) {
    var entry = stack[stack.length - 1];
    if(entry && entry.catchLoc === catchLoc) {
      stack.pop();
    }
  };

  Machine.prototype.popFinally = function(stack, finallyLoc) {
    var entry = stack[stack.length - 1];

    if(!entry || !entry.finallyLoc) {
      stack.pop();
      entry = stack[stack.length - 1];
    }

    if(entry && entry.finallyLoc === finallyLoc) {
      stack.pop();
    }
  };

  Machine.prototype.dispatchException = function(exc) {
    var frames = this.getFrames();
    var dispatched = false;
    // TODO: don't force this?
    this.stepping = false;

    for(var i=frames.length - 1; i >= 0; i--) {
      var frame = frames[i];

      if(frame.dispatchException(exc)) {
        frame.child = null;
        frames.length = i + 1;
        dispatched = true;
        break;
      }
    }

    if(dispatched) {
      this.error = null;
      var ctx = this.rootFrame.ctx;
      this.rootFrame.restore();
      this.checkStatus(ctx);
    }
    
    return dispatched;
  };

  Machine.prototype.keys = function(obj) {
    return Object.keys(obj).reverse();
  };

  // frame

  function Frame(machineId, name, fn, state, scope,
                 thisPtr, tryStack, ctx, child) {
    this.machineId = machineId;
    this.name = name;
    this.fn = fn;
    this.state = state;
    this.scope = scope;
    this.thisPtr = thisPtr;
    this.tryStack = tryStack;
    this.ctx = ctx;
    this.child = child;
  }

  Frame.prototype.restore = function() {
    this.fn.$ctx = this.ctx;
    this.fn.call(this.thisPtr);
  };

  Frame.prototype.evaluate = function(machine, expr) {
    machine.evalArg = expr;
    machine.error = null;
    machine.stepping = true;

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

    if(machine.error) {
      var err = machine.error;
      machine.error = null;
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

  Frame.prototype.getLocation = function(machine) {
    return machine.debugInfo.data[this.machineId].locs[this.ctx.next];
  };

  Frame.prototype.dispatchException = function(exc) {
    if(!this.tryStack) {
      return false;
    }

    var next;
    var hasCaught = false;
    var hasFinally = false;
    var finallyEntries = [];

    for(var i=this.tryStack.length - 1; i >= 0; i--) {
      var entry = this.tryStack[i];
      if(entry.catchLoc) {
        next = entry.catchLoc;
        hasCaught = true;
        break;
      }
      else if(entry.finallyLoc) {
        finallyEntries.push(entry);
        hasFinally = true;
      }
    }

    // initially, `next` is undefined which will jump to the end of the
    // function. (the default case)
    while((entry = finallyEntries.pop())) {
      this.ctx[entry.finallyTempVar] = next;
      next = entry.finallyLoc;
    }
    
    this.ctx.next = next;
    if(hasCaught) {
      this.ctx.thrown = exc;
    }

    if(hasFinally && !hasCaught) {
      this.child = null;
      this.restore();
    }

    return hasCaught;
  };

  // debug info

  function DebugInfo(data) {
    this.data = data;
    this.breakpoints = [];
  }

  DebugInfo.fromObject = function(obj) {
    var info = new DebugInfo();
    info.data = obj.data;
    info.breakpoints = obj.breakpoints;
    return info;
  };

  DebugInfo.prototype.lineToMachinePos = function(line) {
    if(!this.data) return null;

    for(var i=0, l=this.data.length; i<l; i++) {
      var locs = this.data[i].locs;
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

  DebugInfo.prototype.toggleBreakpoint = function(line) {
    var idx = this.breakpoints.indexOf(line);
    if(idx === -1) {
      this.breakpoints.push(line);
    }
    else {
      this.breakpoints.splice(idx, 1);
    }
  };

  // context

  function Context() {
    this.reset();
  }

  Context.prototype = {
    constructor: Context,

    reset: function() {
      this.softReset();

      // Pre-initialize at least 20 temporary variables to enable hidden
      // class optimizations for simple generators.
      for (var tempIndex = 0, tempName;
           hasOwn.call(this, tempName = "t" + tempIndex) || tempIndex < 20;
           ++tempIndex) {
        this[tempName] = null;
      }
    },

    softReset: function() {
      this.next = 0;
      this.sent = void 0;
      this.rval = void 0;

      this.frame = null;
      this.childFrame = null;
      this.isCompiled = false;

      this.staticBreakpoint = false;
      this.stepping = false;
    },

    stop: function() {
      this.done = true;

      // if(this.rval === UndefinedValue) {
      //   this.rval = undefined;
      // }

      return this.rval;
    }

    // delegateYield: function(generator, resultName, nextLoc) {
    //   var info = generator.next(this.sent);

    //   if (info.done) {
    //     this.delegate = null;
    //     this[resultName] = info.value;
    //     this.next = nextLoc;

    //     return ContinueSentinel;
    //   }

    //   this.delegate = {
    //     generator: generator,
    //     resultName: resultName,
    //     nextLoc: nextLoc
    //   };

    //   return info.value;
    // }
  };

  // exports

  global.$Machine = Machine;
  global.$Frame = Frame;
  global.$DebugInfo = DebugInfo;
  if(typeof exports !== 'undefined') {
    exports.$Machine = Machine;
    exports.$Frame = Frame;
    exports.$DebugInfo = DebugInfo;
  }

}).call(this, (function() { return this; })());
