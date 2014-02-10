
__debug_sourceURL="test.js";
var __debugInfo = [{
      "finalLoc": 30,

      "locs": {
        "0": {
          "start": {
            "line": 2,
            "column": 0
          },

          "end": {
            "line": 4,
            "column": 1
          }
        },

        "3": {
          "start": {
            "line": 6,
            "column": 0
          },

          "end": {
            "line": 24,
            "column": 1
          }
        },

        "6": {
          "start": {
            "line": 26,
            "column": 0
          },

          "end": {
            "line": 26,
            "column": 23
          }
        },

        "14": {
          "start": {
            "line": 27,
            "column": 0
          },

          "end": {
            "line": 27,
            "column": 5
          }
        },

        "22": {
          "start": {
            "line": 28,
            "column": 0
          },

          "end": {
            "line": 28,
            "column": 21
          }
        }
      }
    }, {
      "finalLoc": 1,
      "locs": {}
    }, {
      "finalLoc": 78,

      "locs": {
        "0": {
          "start": {
            "line": 7,
            "column": 2
          },

          "end": {
            "line": 23,
            "column": 3
          }
        },

        "1": {
          "start": {
            "line": 8,
            "column": 4
          },

          "end": {
            "line": 15,
            "column": 5
          }
        },

        "2": {
          "start": {
            "line": 9,
            "column": 6
          },

          "end": {
            "line": 9,
            "column": 22
          }
        },

        "10": {
          "start": {
            "line": 10,
            "column": 6
          },

          "end": {
            "line": 10,
            "column": 11
          }
        },

        "18": {
          "start": {
            "line": 11,
            "column": 6
          },

          "end": {
            "line": 11,
            "column": 22
          }
        },

        "26": {
          "start": {
            "line": 8,
            "column": 4
          },

          "end": {
            "line": 15,
            "column": 5
          }
        },

        "29": {
          "start": {
            "line": 8,
            "column": 4
          },

          "end": {
            "line": 15,
            "column": 5
          }
        },

        "32": {
          "start": {
            "line": 14,
            "column": 6
          },

          "end": {
            "line": 14,
            "column": 22
          }
        },

        "40": {
          "start": {
            "line": 17,
            "column": 4
          },

          "end": {
            "line": 17,
            "column": 20
          }
        },

        "48": {
          "start": {
            "line": 18,
            "column": 4
          },

          "end": {
            "line": 18,
            "column": 9
          }
        },

        "56": {
          "start": {
            "line": 19,
            "column": 4
          },

          "end": {
            "line": 19,
            "column": 21
          }
        },

        "64": {
          "start": {
            "line": 7,
            "column": 2
          },

          "end": {
            "line": 23,
            "column": 3
          }
        },

        "67": {
          "start": {
            "line": 7,
            "column": 2
          },

          "end": {
            "line": 23,
            "column": 3
          }
        },

        "70": {
          "start": {
            "line": 22,
            "column": 4
          },

          "end": {
            "line": 22,
            "column": 20
          }
        }
      }
    }];

(function(global) {
  var hasOwn = Object.prototype.hasOwnProperty;

  // since eval is used, need access to the compiler

  if(typeof module !== 'undefined') {
    var compiler = require('./main.js');
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
    console.log('pushing try', catchLoc);

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

    console.log(stack);
  };

  Machine.prototype.popCatch = function(stack, catchLoc) {
    console.log('popped catch');
    console.log(stack);
    var entry = stack[stack.length - 1];
    if(entry && entry.catchLoc === catchLoc) {
      stack.pop();
    }
    console.log(stack);
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

    console.log('length', frames.length);

    for(var i=frames.length - 1; i >= 0; i--) {
      var frame = frames[i];

      if(frame.dispatchException(exc)) {
        frame.child = null;
        frames.length = i + 1;
        dispatched = true;
        break;
      }
    }

    console.log(dispatched, frames.length);

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

    console.log('tryStack', this.tryStack);
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

    console.log('tryStack', this.tryStack);
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

var bar, foo;

function $__global() {
  var $ctx = $__global.$ctx;

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
        bar = function $bar() {
          var $ctx = $bar.$ctx;

          if ($ctx === undefined)
            return VM.execute($bar, null, this, arguments);

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
                throw new Error('dont tread on me');
              default:
              case 1:
                $bar.$ctx = undefined;
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

          $ctx.frame = new $Frame(1, "bar", $bar, {}, [{
            "name": "bar",
            "boxed": false
          }, {
            "name": "foo",
            "boxed": false
          }], this, null, $ctx, $ctx.childFrame);

          $bar.$ctx = undefined;
        };

        $ctx.next = 3;
        break;
      case 3:
        foo = function $foo() {
          var $ctx = $foo.$ctx;

          if ($ctx === undefined)
            return VM.execute($foo, null, this, arguments);

          $ctx.isCompiled = true;
          var tryStack = [];

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
                VM.pushTry(tryStack, 67, null, null);
                VM.pushTry(tryStack, 29, null, null);
                var $t1 = VM.getContext();
                console.log.$ctx = $t1;
                var $t2 = console.log('0');
                $ctx.next = 10;

                if ($t1.frame) {
                  $ctx.childFrame = $t1.frame;
                  $ctx.resultLoc = "t0";
                  VM.stepping = true;
                  break;
                }

                $ctx.t0 = ($t1.isCompiled ? $t1.rval : $t2);
                VM.releaseContext();
                break;
              case 10:
                var $t4 = VM.getContext();
                bar.$ctx = $t4;
                var $t5 = bar();
                $ctx.next = 18;

                if ($t4.frame) {
                  $ctx.childFrame = $t4.frame;
                  $ctx.resultLoc = "t3";
                  VM.stepping = true;
                  break;
                }

                $ctx.t3 = ($t4.isCompiled ? $t4.rval : $t5);
                VM.releaseContext();
                break;
              case 18:
                var $t7 = VM.getContext();
                console.log.$ctx = $t7;
                var $t8 = console.log('1');
                $ctx.next = 26;

                if ($t7.frame) {
                  $ctx.childFrame = $t7.frame;
                  $ctx.resultLoc = "t6";
                  VM.stepping = true;
                  break;
                }

                $ctx.t6 = ($t7.isCompiled ? $t7.rval : $t8);
                VM.releaseContext();
                break;
              case 26:
                VM.popCatch(tryStack, 29);
                $ctx.next = 40;
                break;
              case 29:
                VM.popCatch(tryStack, 29);
                $ctx.t9 = $ctx.thrown;
                $ctx.thrown = null;
                var $t11 = VM.getContext();
                console.log.$ctx = $t11;
                var $t12 = console.log('2');
                $ctx.next = 40;

                if ($t11.frame) {
                  $ctx.childFrame = $t11.frame;
                  $ctx.resultLoc = "t10";
                  VM.stepping = true;
                  break;
                }

                $ctx.t10 = ($t11.isCompiled ? $t11.rval : $t12);
                VM.releaseContext();
                break;
              case 40:
                var $t14 = VM.getContext();
                console.log.$ctx = $t14;
                var $t15 = console.log('3');
                $ctx.next = 48;

                if ($t14.frame) {
                  $ctx.childFrame = $t14.frame;
                  $ctx.resultLoc = "t13";
                  VM.stepping = true;
                  break;
                }

                $ctx.t13 = ($t14.isCompiled ? $t14.rval : $t15);
                VM.releaseContext();
                break;
              case 48:
                var $t17 = VM.getContext();
                bar.$ctx = $t17;
                var $t18 = bar();
                $ctx.next = 56;

                if ($t17.frame) {
                  $ctx.childFrame = $t17.frame;
                  $ctx.resultLoc = "t16";
                  VM.stepping = true;
                  break;
                }

                $ctx.t16 = ($t17.isCompiled ? $t17.rval : $t18);
                VM.releaseContext();
                break;
              case 56:
                var $t20 = VM.getContext();
                console.log.$ctx = $t20;
                var $t21 = console.log('3a');
                $ctx.next = 64;

                if ($t20.frame) {
                  $ctx.childFrame = $t20.frame;
                  $ctx.resultLoc = "t19";
                  VM.stepping = true;
                  break;
                }

                $ctx.t19 = ($t20.isCompiled ? $t20.rval : $t21);
                VM.releaseContext();
                break;
              case 64:
                VM.popCatch(tryStack, 67);
                $ctx.next = 78;
                break;
              case 67:
                VM.popCatch(tryStack, 67);
                $ctx.t22 = $ctx.thrown;
                $ctx.thrown = null;
                var $t24 = VM.getContext();
                console.log.$ctx = $t24;
                var $t25 = console.log('4');
                $ctx.next = 78;

                if ($t24.frame) {
                  $ctx.childFrame = $t24.frame;
                  $ctx.resultLoc = "t23";
                  VM.stepping = true;
                  break;
                }

                $ctx.t23 = ($t24.isCompiled ? $t24.rval : $t25);
                VM.releaseContext();
                break;
              default:
              case 78:
                $foo.$ctx = undefined;
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

          $ctx.frame = new $Frame(2, "foo", $foo, {}, [{
            "name": "bar",
            "boxed": false
          }, {
            "name": "foo",
            "boxed": false
          }], this, tryStack, $ctx, $ctx.childFrame);

          $foo.$ctx = undefined;
        };

        $ctx.next = 6;
        break;
      case 6:
        var $t27 = VM.getContext();
        console.log.$ctx = $t27;
        var $t28 = console.log('starting');
        $ctx.next = 14;

        if ($t27.frame) {
          $ctx.childFrame = $t27.frame;
          $ctx.resultLoc = "t26";
          VM.stepping = true;
          break;
        }

        $ctx.t26 = ($t27.isCompiled ? $t27.rval : $t28);
        VM.releaseContext();
        break;
      case 14:
        var $t30 = VM.getContext();
        foo.$ctx = $t30;
        var $t31 = foo();
        $ctx.next = 22;

        if ($t30.frame) {
          $ctx.childFrame = $t30.frame;
          $ctx.resultLoc = "t29";
          VM.stepping = true;
          break;
        }

        $ctx.t29 = ($t30.isCompiled ? $t30.rval : $t31);
        VM.releaseContext();
        break;
      case 22:
        var $t33 = VM.getContext();
        console.log.$ctx = $t33;
        var $t34 = console.log('ending');
        $ctx.next = 30;

        if ($t33.frame) {
          $ctx.childFrame = $t33.frame;
          $ctx.resultLoc = "t32";
          VM.stepping = true;
          break;
        }

        $ctx.t32 = ($t33.isCompiled ? $t33.rval : $t34);
        VM.releaseContext();
        break;
      default:
      case 30:
        $__global.$ctx = undefined;
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

  $ctx.frame = new $Frame(0, "__global", $__global, {
    "bar": bar,
    "foo": foo
  }, [{
    "name": "bar",
    "boxed": false
  }, {
    "name": "foo",
    "boxed": false
  }], this, null, $ctx, $ctx.childFrame);

  $__global.$ctx = undefined;
}

var VM = new $Machine();
VM.on("error", function(e) { throw e; });
VM.run($__global, __debugInfo);
