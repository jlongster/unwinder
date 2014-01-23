
__debug_sourceURL="test.js";
var __debugInfo = [{
      "finalLoc": 15,

      "locs": {
        "6": {
          "start": {
            "line": 8,
            "column": 0
          },

          "end": {
            "line": 8,
            "column": 5
          }
        }
      }
    }, {
      "finalLoc": 3,
      "locs": {}
    }];

(function(global) {
  var hasOwn = Object.prototype.hasOwnProperty;

  // since eval is used, need access to the compiler

  if(typeof module !== 'undefined') {
    var compiler = require('./main.js');
  }
  else {
    var compiler = foo;
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
  }

  // 3 ways to execute code:
  // 
  // * run: the main entry point. give it a string and it will being the program
  // * execute: runs a function instance. use this to run individual
  //   state machines
  // * evaluate: evalutes a code string in the global scope

  Machine.prototype.execute = function(fn, debugInfo, thisPtr, args) {
    if(this.state === 'SUSPENDED') {
      return;
    }

    this.state = EXECUTING;

    if(debugInfo) {
      this.setDebugInfo(new DebugInfo(debugInfo));
    }

    var prevStepping = this.stepping;
    this.stepping = false;

    var ctx = fn.$ctx = this.getContext();
    ctx.softReset();
    if(thisPtr || args) {
      fn.apply(thisPtr, args || []);
    }
    else {
      fn();
    }

    this.checkStatus(ctx);
    this.stepping = prevStepping;

    // clean up the function, since this property is used to tell if
    // we are inside our VM or not
    delete fn.$ctx;

    return ctx.rval;
  };

  Machine.prototype.run = function(code, debugInfo) {
    if(typeof code === 'string') {
      var fn = new Function('VM', '$Frame', code);
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

    if(this.rootFrame) {
      var top = this.getTopFrame();
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

      this.rootFrame.name = '<top-level>';
      this.lastEval = res.result;
      return this.lastEval;
    }
    else if(this.globalFn) {
      // TODO: seek out functions, compile them, and convert them to
      // assignments

      if(expr.indexOf('function') !== -1) {
        expr = compiler(expr).code;
      }

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
      // machine was paused
      this.state = SUSPENDED;
      this.rootFrame = ctx.frame;

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

  Machine.allocCache = function() {
    this.cacheSize = 30000;
    this._contexts = new Array(this.cacheSize);
    this.contextptr = 0;
    for(var i=0; i<this.cacheSize; i++) {
      this._contexts[i] = new Context();
    }
  };

  Machine.prototype.getContext = function() {
    if(this.contextptr < this.cacheSize) {
      return this._contexts[this.contextptr++];
    }
    else {
      return new Context();
    }
  };

  Machine.prototype.releaseContext = function() {
    this.contextptr--;
  };


  // frame

  function Frame(machineId, name, fn, state, scope,
                 thisPtr, ctx, child) {
    this.machineId = machineId;
    this.name = name;
    this.fn = fn;
    this.state = state;
    this.scope = scope;
    this.thisPtr = thisPtr;
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

var $__global = function() {
      var x, foo;

      function $$__global() {
        var $ctx = $$__global.$ctx;

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
              foo = function $foo() {
                var $ctx = $foo.$ctx;

                if ($ctx === undefined)
                  return VM.execute($foo, null, this, arguments);

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
                      x++;
                      $ctx.next = 3;
                      break;
                    default:
                    case 3:
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

                $ctx.frame = new $Frame(1, "foo", $foo, {}, [{
                  "name": "x",
                  "boxed": false
                }, {
                  "name": "foo",
                  "boxed": false
                }], this, $ctx, $ctx.childFrame);

                $foo.$ctx = undefined;
              };

              $ctx.next = 3;
              break;
            case 3:
              x = 0;
              $ctx.next = 6;
              break;
            case 6:
              var $t1 = VM.getContext();
              $t1.softReset();
              foo.$ctx = $t1;
              var $t2 = foo();
              $ctx.next = 15;

              if ($t1.frame) {
                $ctx.childFrame = $t1.frame;
                $ctx.resultLoc = "t0";
                VM.stepping = true;
                break;
              }

              $ctx.t0 = ($t1.isCompiled ? $t1.rval : $t2);
              VM.releaseContext();
              break;
            default:
            case 15:
              $$__global.$ctx = undefined;
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

        $ctx.frame = new $Frame(0, "$__global", $$__global, {
          "x": x,
          "foo": foo
        }, [{
          "name": "x",
          "boxed": false
        }, {
          "name": "foo",
          "boxed": false
        }], this, $ctx, $ctx.childFrame);

        $$__global.$ctx = undefined;
      }

      return $$__global;
    }();

var VM = new $Machine();
VM.on("error", function(e) { throw e; });
VM.run($__global, __debugInfo);

VM.evaluate('foo()');
VM.evaluate('foo()');
VM.evaluate('foo()');
VM.evaluate('foo()');

VM.evaluate('function foo() { x += 2 }');
console.log(VM.evaluate('x'));
VM.evaluate('foo()');
console.log(VM.evaluate('x'));
