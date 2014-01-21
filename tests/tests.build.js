(function(global) {
  var hasOwn = Object.prototype.hasOwnProperty;

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
  }

  // Machine.prototype.loadProgram = function(fn) {
  //   this.program = fn;
  // };

  Machine.prototype.runProgram = function(fn, thisPtr, args) {
    if(this.state === 'SUSPENDED') {
      return;
    }

    this.state = EXECUTING;

    var stepping = this.stepping;
    var hasbp = this.hasBreakpoints;

    this.hasBreakpoints = false;
    this.stepping = false;

    var ctx = fn.$ctx = this.getContext();
    ctx.softReset();

    //if(args.length) {
      fn.apply(thisPtr, args || []);
    // }
    // else {
    //   fn();
    // }

    this.hasBreakpoints = hasbp;
    this.stepping = stepping;
    this.checkStatus(ctx);

    // clean up the function, since this property is used to tell if
    // we are inside our VM or not
    delete fn.$ctx;

    return ctx.rval;
  };

  Machine.prototype.checkStatus = function(ctx) {
    if(ctx.frame) {
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

  Machine.prototype.begin = function(code, debugInfo) {
    var fn = new Function('VM', '$Frame', 'return ' + code.trim());
    var rootFn = fn(this, $Frame);

    this.beginFunc(rootFn, debugInfo);
  };

  Machine.prototype.beginFunc = function(func, debugInfo) {
    if(this.state === 'SUSPENDED') {
      return;
    }

    this.setDebugInfo(debugInfo);
    this.state = EXECUTING;
    this.stepping = false;

    var ctx = func.$ctx = this.getContext();
    ctx.softReset();
    func();

    // a frame should have been returned
    ctx.frame.name = '<top-level>';
    this.rootFrame = ctx.frame;
    this.checkStatus(ctx);    
  };

  Machine.prototype.continue = function() {
    if(this.rootFrame && this.state === SUSPENDED) {
      // We need to get past this instruction that has a breakpoint, so
      // turn off breakpoints and step past it, then turn them back on
      // again and execute normally
      this.stepping = true;
      this.hasBreakpoints = false;
      this.rootFrame.restore();

      var nextFrame = this.rootFrame.ctx.frame;
      this.hasBreakpoints = true;
      this.stepping = false;
      nextFrame.restore();
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
    else if(this.rootFrame) {
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

var __debugInfo = [{
      "finalLoc": 48,

      "locs": {
        "0": {
          "start": {
            "line": 1,
            "column": 13
          },

          "end": {
            "line": 1,
            "column": 33
          }
        },

        "9": {
          "start": {
            "line": 1,
            "column": 4
          },

          "end": {
            "line": 1,
            "column": 33
          }
        },

        "10": {
          "start": {
            "line": 1,
            "column": 4
          },

          "end": {
            "line": 1,
            "column": 33
          }
        },

        "12": {
          "start": {
            "line": 3,
            "column": 18
          },

          "end": {
            "line": 9,
            "column": 1
          }
        },

        "15": {
          "start": {
            "line": 3,
            "column": 0
          },

          "end": {
            "line": 9,
            "column": 2
          }
        },

        "24": {
          "start": {
            "line": 11,
            "column": 23
          },

          "end": {
            "line": 84,
            "column": 1
          }
        },

        "27": {
          "start": {
            "line": 11,
            "column": 0
          },

          "end": {
            "line": 84,
            "column": 2
          }
        },

        "36": {
          "start": {
            "line": 86,
            "column": 23
          },

          "end": {
            "line": 101,
            "column": 1
          }
        },

        "39": {
          "start": {
            "line": 86,
            "column": 0
          },

          "end": {
            "line": 101,
            "column": 2
          }
        }
      }
    }, {
      "finalLoc": 12,

      "locs": {
        "0": {
          "start": {
            "line": 4,
            "column": 28
          },

          "end": {
            "line": 8,
            "column": 3
          }
        },

        "3": {
          "start": {
            "line": 4,
            "column": 2
          },

          "end": {
            "line": 8,
            "column": 4
          }
        }
      }
    }, {
      "finalLoc": 63,

      "locs": {
        "0": {
          "start": {
            "line": 5,
            "column": 11
          },

          "end": {
            "line": 5,
            "column": 26
          }
        },

        "3": {
          "start": {
            "line": 5,
            "column": 4
          },

          "end": {
            "line": 5,
            "column": 27
          }
        },

        "12": {
          "start": {
            "line": 5,
            "column": 4
          },

          "end": {
            "line": 5,
            "column": 50
          }
        },

        "21": {
          "start": {
            "line": 6,
            "column": 11
          },

          "end": {
            "line": 6,
            "column": 24
          }
        },

        "24": {
          "start": {
            "line": 6,
            "column": 4
          },

          "end": {
            "line": 6,
            "column": 25
          }
        },

        "33": {
          "start": {
            "line": 6,
            "column": 4
          },

          "end": {
            "line": 6,
            "column": 48
          }
        },

        "42": {
          "start": {
            "line": 7,
            "column": 11
          },

          "end": {
            "line": 7,
            "column": 20
          }
        },

        "45": {
          "start": {
            "line": 7,
            "column": 4
          },

          "end": {
            "line": 7,
            "column": 21
          }
        },

        "54": {
          "start": {
            "line": 7,
            "column": 4
          },

          "end": {
            "line": 7,
            "column": 44
          }
        }
      }
    }, {
      "finalLoc": 84,

      "locs": {
        "0": {
          "start": {
            "line": 12,
            "column": 32
          },

          "end": {
            "line": 18,
            "column": 3
          }
        },

        "3": {
          "start": {
            "line": 12,
            "column": 2
          },

          "end": {
            "line": 18,
            "column": 4
          }
        },

        "12": {
          "start": {
            "line": 20,
            "column": 42
          },

          "end": {
            "line": 23,
            "column": 3
          }
        },

        "15": {
          "start": {
            "line": 20,
            "column": 2
          },

          "end": {
            "line": 23,
            "column": 4
          }
        },

        "24": {
          "start": {
            "line": 25,
            "column": 32
          },

          "end": {
            "line": 31,
            "column": 3
          }
        },

        "27": {
          "start": {
            "line": 25,
            "column": 2
          },

          "end": {
            "line": 31,
            "column": 4
          }
        },

        "36": {
          "start": {
            "line": 33,
            "column": 31
          },

          "end": {
            "line": 43,
            "column": 3
          }
        },

        "39": {
          "start": {
            "line": 33,
            "column": 2
          },

          "end": {
            "line": 43,
            "column": 4
          }
        },

        "48": {
          "start": {
            "line": 45,
            "column": 35
          },

          "end": {
            "line": 51,
            "column": 3
          }
        },

        "51": {
          "start": {
            "line": 45,
            "column": 2
          },

          "end": {
            "line": 51,
            "column": 4
          }
        },

        "60": {
          "start": {
            "line": 53,
            "column": 37
          },

          "end": {
            "line": 71,
            "column": 3
          }
        },

        "63": {
          "start": {
            "line": 53,
            "column": 2
          },

          "end": {
            "line": 71,
            "column": 4
          }
        },

        "72": {
          "start": {
            "line": 73,
            "column": 31
          },

          "end": {
            "line": 83,
            "column": 3
          }
        },

        "75": {
          "start": {
            "line": 73,
            "column": 2
          },

          "end": {
            "line": 83,
            "column": 4
          }
        }
      }
    }, {
      "finalLoc": 60,

      "locs": {
        "0": {
          "start": {
            "line": 13,
            "column": 8
          },

          "end": {
            "line": 13,
            "column": 14
          }
        },

        "1": {
          "start": {
            "line": 13,
            "column": 8
          },

          "end": {
            "line": 13,
            "column": 14
          }
        },

        "3": {
          "start": {
            "line": 14,
            "column": 4
          },

          "end": {
            "line": 14,
            "column": 13
          }
        },

        "12": {
          "start": {
            "line": 14,
            "column": 4
          },

          "end": {
            "line": 14,
            "column": 23
          }
        },

        "21": {
          "start": {
            "line": 15,
            "column": 4
          },

          "end": {
            "line": 15,
            "column": 13
          }
        },

        "30": {
          "start": {
            "line": 15,
            "column": 4
          },

          "end": {
            "line": 15,
            "column": 30
          }
        },

        "39": {
          "start": {
            "line": 16,
            "column": 8
          },

          "end": {
            "line": 16,
            "column": 17
          }
        },

        "40": {
          "start": {
            "line": 16,
            "column": 8
          },

          "end": {
            "line": 16,
            "column": 17
          }
        },

        "42": {
          "start": {
            "line": 17,
            "column": 4
          },

          "end": {
            "line": 17,
            "column": 13
          }
        },

        "51": {
          "start": {
            "line": 17,
            "column": 4
          },

          "end": {
            "line": 17,
            "column": 23
          }
        }
      }
    }, {
      "finalLoc": 27,

      "locs": {
        "0": {
          "start": {
            "line": 21,
            "column": 17
          },

          "end": {
            "line": 21,
            "column": 22
          }
        },

        "3": {
          "start": {
            "line": 21,
            "column": 17
          },

          "end": {
            "line": 21,
            "column": 26
          }
        },

        "6": {
          "start": {
            "line": 21,
            "column": 8
          },

          "end": {
            "line": 21,
            "column": 26
          }
        },

        "7": {
          "start": {
            "line": 21,
            "column": 8
          },

          "end": {
            "line": 21,
            "column": 26
          }
        },

        "9": {
          "start": {
            "line": 22,
            "column": 4
          },

          "end": {
            "line": 22,
            "column": 13
          }
        },

        "18": {
          "start": {
            "line": 22,
            "column": 4
          },

          "end": {
            "line": 22,
            "column": 25
          }
        }
      }
    }, {
      "finalLoc": 30,

      "locs": {
        "0": {
          "start": {
            "line": 26,
            "column": 4
          },

          "end": {
            "line": 28,
            "column": 5
          }
        },

        "1": {
          "start": {
            "line": 26,
            "column": 4
          },

          "end": {
            "line": 28,
            "column": 5
          }
        },

        "3": {
          "start": {
            "line": 30,
            "column": 11
          },

          "end": {
            "line": 30,
            "column": 17
          }
        },

        "12": {
          "start": {
            "line": 30,
            "column": 4
          },

          "end": {
            "line": 30,
            "column": 18
          }
        },

        "21": {
          "start": {
            "line": 30,
            "column": 4
          },

          "end": {
            "line": 30,
            "column": 27
          }
        }
      }
    }, {
      "finalLoc": 4,

      "locs": {
        "0": {
          "start": {
            "line": 27,
            "column": 6
          },

          "end": {
            "line": 27,
            "column": 19
          }
        }
      }
    }, {
      "finalLoc": 69,

      "locs": {
        "0": {
          "start": {
            "line": 34,
            "column": 4
          },

          "end": {
            "line": 38,
            "column": 5
          }
        },

        "1": {
          "start": {
            "line": 34,
            "column": 4
          },

          "end": {
            "line": 38,
            "column": 5
          }
        },

        "3": {
          "start": {
            "line": 40,
            "column": 12
          },

          "end": {
            "line": 40,
            "column": 18
          }
        },

        "12": {
          "start": {
            "line": 40,
            "column": 8
          },

          "end": {
            "line": 40,
            "column": 18
          }
        },

        "13": {
          "start": {
            "line": 40,
            "column": 8
          },

          "end": {
            "line": 40,
            "column": 18
          }
        },

        "15": {
          "start": {
            "line": 41,
            "column": 11
          },

          "end": {
            "line": 41,
            "column": 16
          }
        },

        "24": {
          "start": {
            "line": 41,
            "column": 4
          },

          "end": {
            "line": 41,
            "column": 17
          }
        },

        "33": {
          "start": {
            "line": 41,
            "column": 4
          },

          "end": {
            "line": 41,
            "column": 27
          }
        },

        "42": {
          "start": {
            "line": 42,
            "column": 11
          },

          "end": {
            "line": 42,
            "column": 16
          }
        },

        "51": {
          "start": {
            "line": 42,
            "column": 4
          },

          "end": {
            "line": 42,
            "column": 17
          }
        },

        "60": {
          "start": {
            "line": 42,
            "column": 4
          },

          "end": {
            "line": 42,
            "column": 27
          }
        }
      }
    }, {
      "finalLoc": 4,

      "locs": {
        "0": {
          "start": {
            "line": 35,
            "column": 6
          },

          "end": {
            "line": 37,
            "column": 8
          }
        }
      }
    }, {
      "finalLoc": 4,

      "locs": {
        "0": {
          "start": {
            "line": 36,
            "column": 8
          },

          "end": {
            "line": 36,
            "column": 21
          }
        }
      }
    }, {
      "finalLoc": 35,

      "locs": {
        "0": {
          "start": {
            "line": 46,
            "column": 8
          },

          "end": {
            "line": 46,
            "column": 13
          }
        },

        "1": {
          "start": {
            "line": 46,
            "column": 8
          },

          "end": {
            "line": 46,
            "column": 13
          }
        },

        "3": {
          "start": {
            "line": 47,
            "column": 12
          },

          "end": {
            "line": 47,
            "column": 15
          }
        },

        "4": {
          "start": {
            "line": 47,
            "column": 12
          },

          "end": {
            "line": 47,
            "column": 15
          }
        },

        "6": {
          "start": {
            "line": 47,
            "column": 17
          },

          "end": {
            "line": 47,
            "column": 22
          }
        },

        "9": {
          "start": {
            "line": 48,
            "column": 6
          },

          "end": {
            "line": 48,
            "column": 9
          }
        },

        "10": {
          "start": {
            "line": 48,
            "column": 6
          },

          "end": {
            "line": 48,
            "column": 9
          }
        },

        "12": {
          "start": {
            "line": 47,
            "column": 24
          },

          "end": {
            "line": 47,
            "column": 27
          }
        },

        "13": {
          "start": {
            "line": 47,
            "column": 24
          },

          "end": {
            "line": 47,
            "column": 27
          }
        },

        "17": {
          "start": {
            "line": 50,
            "column": 4
          },

          "end": {
            "line": 50,
            "column": 13
          }
        },

        "26": {
          "start": {
            "line": 50,
            "column": 4
          },

          "end": {
            "line": 50,
            "column": 24
          }
        }
      }
    }, {
      "finalLoc": 104,

      "locs": {
        "0": {
          "start": {
            "line": 54,
            "column": 8
          },

          "end": {
            "line": 54,
            "column": 13
          }
        },

        "1": {
          "start": {
            "line": 54,
            "column": 8
          },

          "end": {
            "line": 54,
            "column": 13
          }
        },

        "3": {
          "start": {
            "line": 55,
            "column": 8
          },

          "end": {
            "line": 55,
            "column": 13
          }
        },

        "4": {
          "start": {
            "line": 55,
            "column": 8
          },

          "end": {
            "line": 55,
            "column": 13
          }
        },

        "6": {
          "start": {
            "line": 56,
            "column": 10
          },

          "end": {
            "line": 56,
            "column": 17
          }
        },

        "9": {
          "start": {
            "line": 57,
            "column": 6
          },

          "end": {
            "line": 57,
            "column": 9
          }
        },

        "10": {
          "start": {
            "line": 57,
            "column": 6
          },

          "end": {
            "line": 57,
            "column": 9
          }
        },

        "12": {
          "start": {
            "line": 58,
            "column": 6
          },

          "end": {
            "line": 58,
            "column": 9
          }
        },

        "13": {
          "start": {
            "line": 58,
            "column": 6
          },

          "end": {
            "line": 58,
            "column": 9
          }
        },

        "17": {
          "start": {
            "line": 60,
            "column": 4
          },

          "end": {
            "line": 60,
            "column": 13
          }
        },

        "26": {
          "start": {
            "line": 60,
            "column": 4
          },

          "end": {
            "line": 60,
            "column": 24
          }
        },

        "35": {
          "start": {
            "line": 61,
            "column": 4
          },

          "end": {
            "line": 61,
            "column": 13
          }
        },

        "44": {
          "start": {
            "line": 61,
            "column": 4
          },

          "end": {
            "line": 61,
            "column": 24
          }
        },

        "53": {
          "start": {
            "line": 63,
            "column": 4
          },

          "end": {
            "line": 63,
            "column": 9
          }
        },

        "54": {
          "start": {
            "line": 63,
            "column": 4
          },

          "end": {
            "line": 63,
            "column": 9
          }
        },

        "56": {
          "start": {
            "line": 64,
            "column": 4
          },

          "end": {
            "line": 64,
            "column": 9
          }
        },

        "57": {
          "start": {
            "line": 64,
            "column": 4
          },

          "end": {
            "line": 64,
            "column": 9
          }
        },

        "59": {
          "start": {
            "line": 66,
            "column": 6
          },

          "end": {
            "line": 66,
            "column": 9
          }
        },

        "60": {
          "start": {
            "line": 66,
            "column": 6
          },

          "end": {
            "line": 66,
            "column": 9
          }
        },

        "62": {
          "start": {
            "line": 67,
            "column": 6
          },

          "end": {
            "line": 67,
            "column": 9
          }
        },

        "63": {
          "start": {
            "line": 67,
            "column": 6
          },

          "end": {
            "line": 67,
            "column": 9
          }
        },

        "65": {
          "start": {
            "line": 68,
            "column": 12
          },

          "end": {
            "line": 68,
            "column": 19
          }
        },

        "68": {
          "start": {
            "line": 69,
            "column": 4
          },

          "end": {
            "line": 69,
            "column": 13
          }
        },

        "77": {
          "start": {
            "line": 69,
            "column": 4
          },

          "end": {
            "line": 69,
            "column": 24
          }
        },

        "86": {
          "start": {
            "line": 70,
            "column": 4
          },

          "end": {
            "line": 70,
            "column": 13
          }
        },

        "95": {
          "start": {
            "line": 70,
            "column": 4
          },

          "end": {
            "line": 70,
            "column": 24
          }
        }
      }
    }, {
      "finalLoc": 45,

      "locs": {
        "0": {
          "start": {
            "line": 77,
            "column": 4
          },

          "end": {
            "line": 79,
            "column": 5
          }
        },

        "1": {
          "start": {
            "line": 77,
            "column": 4
          },

          "end": {
            "line": 79,
            "column": 5
          }
        },

        "3": {
          "start": {
            "line": 74,
            "column": 8
          },

          "end": {
            "line": 74,
            "column": 29
          }
        },

        "4": {
          "start": {
            "line": 74,
            "column": 8
          },

          "end": {
            "line": 74,
            "column": 29
          }
        },

        "6": {
          "start": {
            "line": 75,
            "column": 4
          },

          "end": {
            "line": 75,
            "column": 22
          }
        },

        "15": {
          "start": {
            "line": 75,
            "column": 4
          },

          "end": {
            "line": 75,
            "column": 34
          }
        },

        "24": {
          "start": {
            "line": 81,
            "column": 8
          },

          "end": {
            "line": 81,
            "column": 24
          }
        },

        "25": {
          "start": {
            "line": 81,
            "column": 8
          },

          "end": {
            "line": 81,
            "column": 24
          }
        },

        "27": {
          "start": {
            "line": 82,
            "column": 4
          },

          "end": {
            "line": 82,
            "column": 17
          }
        },

        "36": {
          "start": {
            "line": 82,
            "column": 4
          },

          "end": {
            "line": 82,
            "column": 26
          }
        }
      }
    }, {
      "finalLoc": 3,

      "locs": {
        "0": {
          "start": {
            "line": 78,
            "column": 6
          },

          "end": {
            "line": 78,
            "column": 16
          }
        },

        "1": {
          "start": {
            "line": 78,
            "column": 6
          },

          "end": {
            "line": 78,
            "column": 16
          }
        }
      }
    }, {
      "finalLoc": 12,

      "locs": {
        "0": {
          "start": {
            "line": 87,
            "column": 35
          },

          "end": {
            "line": 100,
            "column": 3
          }
        },

        "3": {
          "start": {
            "line": 87,
            "column": 2
          },

          "end": {
            "line": 100,
            "column": 4
          }
        }
      }
    }, {
      "finalLoc": 24,

      "locs": {
        "0": {
          "start": {
            "line": 89,
            "column": 4
          },

          "end": {
            "line": 94,
            "column": 5
          }
        },

        "1": {
          "start": {
            "line": 89,
            "column": 4
          },

          "end": {
            "line": 94,
            "column": 5
          }
        },

        "3": {
          "start": {
            "line": 88,
            "column": 8
          },

          "end": {
            "line": 88,
            "column": 32
          }
        },

        "4": {
          "start": {
            "line": 88,
            "column": 8
          },

          "end": {
            "line": 88,
            "column": 32
          }
        },

        "6": {
          "start": {
            "line": 95,
            "column": 4
          },

          "end": {
            "line": 95,
            "column": 27
          }
        },

        "15": {
          "start": {
            "line": 99,
            "column": 4
          },

          "end": {
            "line": 99,
            "column": 34
          }
        }
      }
    }, {
      "finalLoc": 18,

      "locs": {
        "0": {
          "start": {
            "line": 90,
            "column": 10
          },

          "end": {
            "line": 90,
            "column": 15
          }
        },

        "1": {
          "start": {
            "line": 90,
            "column": 10
          },

          "end": {
            "line": 90,
            "column": 15
          }
        },

        "3": {
          "start": {
            "line": 91,
            "column": 6
          },

          "end": {
            "line": 91,
            "column": 15
          }
        },

        "6": {
          "start": {
            "line": 92,
            "column": 6
          },

          "end": {
            "line": 92,
            "column": 35
          }
        },

        "15": {
          "start": {
            "line": 93,
            "column": 6
          },

          "end": {
            "line": 93,
            "column": 11
          }
        },

        "16": {
          "start": {
            "line": 93,
            "column": 6
          },

          "end": {
            "line": 93,
            "column": 11
          }
        }
      }
    }];

function $__root() {
  var expect;
  var $ctx = $__root.$ctx;

  if ($ctx === undefined)
    return VM.runProgram($__root, this, arguments);

  $ctx.isCompiled = true;

  if ($ctx.frame) {
    expect = $ctx.frame.scope.expect;
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

  try {
    while (1) {
      if (VM.hasBreakpoints && VM.machineBreaks[0][$ctx.next] !== undefined)
        break;

      switch ($ctx.next) {
      case 0:
        var $t1 = VM.getContext();

        if (require)
          require.$ctx = $t1;

        $t1.softReset();
        var $t2 = require('expect.js');
        $ctx.next = 9;

        if ($t1.frame) {
          $ctx.childFrame = $t1.frame;
          $ctx.resultLoc = "t0";
          VM.stepping = true;
          break;
        }

        $ctx.t0 = ($t1.isCompiled ? $t1.rval : $t2);
        VM.releaseContext();
      case 9:
        expect = $ctx.t0;
        $ctx.next = 12;
      case 12:
        $ctx.t5 = function $anon1() {
          var $ctx = $anon1.$ctx;

          if ($ctx === undefined)
            return VM.runProgram($anon1, this, arguments);

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

          try {
            while (1) {
              if (VM.hasBreakpoints && VM.machineBreaks[1][$ctx.next] !== undefined)
                break;

              switch ($ctx.next) {
              case 0:
                $ctx.t17 = function $anon2() {
                  var $ctx = $anon2.$ctx;

                  if ($ctx === undefined)
                    return VM.runProgram($anon2, this, arguments);

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

                  try {
                    while (1) {
                      if (VM.hasBreakpoints && VM.machineBreaks[2][$ctx.next] !== undefined)
                        break;

                      switch ($ctx.next) {
                      case 0:
                        $ctx.t21 = typeof $Machine;
                        $ctx.next = 3;
                      case 3:
                        var $t20 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t20;

                        $t20.softReset();
                        var $t22 = expect($ctx.t21);
                        $ctx.next = 12;

                        if ($t20.frame) {
                          $ctx.childFrame = $t20.frame;
                          $ctx.resultLoc = "t19";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t19 = ($t20.isCompiled ? $t20.rval : $t22);
                        VM.releaseContext();
                      case 12:
                        var $t24 = VM.getContext();

                        if ($ctx.t19.to.not.be)
                          $ctx.t19.to.not.be.$ctx = $t24;

                        $t24.softReset();
                        var $t25 = $ctx.t19.to.not.be('undefined');
                        $ctx.next = 21;

                        if ($t24.frame) {
                          $ctx.childFrame = $t24.frame;
                          $ctx.resultLoc = "t23";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t23 = ($t24.isCompiled ? $t24.rval : $t25);
                        VM.releaseContext();
                      case 21:
                        $ctx.t28 = typeof $Frame;
                        $ctx.next = 24;
                      case 24:
                        var $t27 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t27;

                        $t27.softReset();
                        var $t29 = expect($ctx.t28);
                        $ctx.next = 33;

                        if ($t27.frame) {
                          $ctx.childFrame = $t27.frame;
                          $ctx.resultLoc = "t26";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t26 = ($t27.isCompiled ? $t27.rval : $t29);
                        VM.releaseContext();
                      case 33:
                        var $t31 = VM.getContext();

                        if ($ctx.t26.to.not.be)
                          $ctx.t26.to.not.be.$ctx = $t31;

                        $t31.softReset();
                        var $t32 = $ctx.t26.to.not.be('undefined');
                        $ctx.next = 42;

                        if ($t31.frame) {
                          $ctx.childFrame = $t31.frame;
                          $ctx.resultLoc = "t30";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t30 = ($t31.isCompiled ? $t31.rval : $t32);
                        VM.releaseContext();
                      case 42:
                        $ctx.t35 = typeof VM;
                        $ctx.next = 45;
                      case 45:
                        var $t34 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t34;

                        $t34.softReset();
                        var $t36 = expect($ctx.t35);
                        $ctx.next = 54;

                        if ($t34.frame) {
                          $ctx.childFrame = $t34.frame;
                          $ctx.resultLoc = "t33";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t33 = ($t34.isCompiled ? $t34.rval : $t36);
                        VM.releaseContext();
                      case 54:
                        var $t38 = VM.getContext();

                        if ($ctx.t33.to.not.be)
                          $ctx.t33.to.not.be.$ctx = $t38;

                        $t38.softReset();
                        var $t39 = $ctx.t33.to.not.be('undefined');
                        $ctx.next = 63;

                        if ($t38.frame) {
                          $ctx.childFrame = $t38.frame;
                          $ctx.resultLoc = "t37";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t37 = ($t38.isCompiled ? $t38.rval : $t39);
                        VM.releaseContext();
                      default:
                      case 63:
                        $anon2.$ctx = undefined;
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

                  $ctx.frame = new $Frame(2, "$anon2", $anon2, {}, ["expect"], this, $ctx, $ctx.childFrame);
                  $anon2.$ctx = undefined;
                };

                $ctx.next = 3;
              case 3:
                var $t16 = VM.getContext();

                if (it)
                  it.$ctx = $t16;

                $t16.softReset();
                var $t18 = it('should have globals', $ctx.t17);
                $ctx.next = 12;

                if ($t16.frame) {
                  $ctx.childFrame = $t16.frame;
                  $ctx.resultLoc = "t15";
                  VM.stepping = true;
                  break;
                }

                $ctx.t15 = ($t16.isCompiled ? $t16.rval : $t18);
                VM.releaseContext();
              default:
              case 12:
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

          $ctx.frame = new $Frame(1, "$anon1", $anon1, {}, ["expect"], this, $ctx, $ctx.childFrame);
          $anon1.$ctx = undefined;
        };

        $ctx.next = 15;
      case 15:
        var $t4 = VM.getContext();

        if (describe)
          describe.$ctx = $t4;

        $t4.softReset();
        var $t6 = describe('setup', $ctx.t5);
        $ctx.next = 24;

        if ($t4.frame) {
          $ctx.childFrame = $t4.frame;
          $ctx.resultLoc = "t3";
          VM.stepping = true;
          break;
        }

        $ctx.t3 = ($t4.isCompiled ? $t4.rval : $t6);
        VM.releaseContext();
      case 24:
        $ctx.t9 = function $anon3() {
          var $ctx = $anon3.$ctx;

          if ($ctx === undefined)
            return VM.runProgram($anon3, this, arguments);

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

          try {
            while (1) {
              if (VM.hasBreakpoints && VM.machineBreaks[3][$ctx.next] !== undefined)
                break;

              switch ($ctx.next) {
              case 0:
                $ctx.t42 = function $anon4() {
                  var x, y;
                  var $ctx = $anon4.$ctx;

                  if ($ctx === undefined)
                    return VM.runProgram($anon4, this, arguments);

                  $ctx.isCompiled = true;

                  if ($ctx.frame) {
                    x = $ctx.frame.scope.x;
                    y = $ctx.frame.scope.y;
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

                  try {
                    while (1) {
                      if (VM.hasBreakpoints && VM.machineBreaks[4][$ctx.next] !== undefined)
                        break;

                      switch ($ctx.next) {
                      case 0:
                        x = 10;
                        $ctx.next = 3;
                      case 3:
                        var $t69 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t69;

                        $t69.softReset();
                        var $t70 = expect(x);
                        $ctx.next = 12;

                        if ($t69.frame) {
                          $ctx.childFrame = $t69.frame;
                          $ctx.resultLoc = "t68";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t68 = ($t69.isCompiled ? $t69.rval : $t70);
                        VM.releaseContext();
                      case 12:
                        var $t72 = VM.getContext();

                        if ($ctx.t68.to.be)
                          $ctx.t68.to.be.$ctx = $t72;

                        $t72.softReset();
                        var $t73 = $ctx.t68.to.be(10);
                        $ctx.next = 21;

                        if ($t72.frame) {
                          $ctx.childFrame = $t72.frame;
                          $ctx.resultLoc = "t71";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t71 = ($t72.isCompiled ? $t72.rval : $t73);
                        VM.releaseContext();
                      case 21:
                        var $t75 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t75;

                        $t75.softReset();
                        var $t76 = expect(y);
                        $ctx.next = 30;

                        if ($t75.frame) {
                          $ctx.childFrame = $t75.frame;
                          $ctx.resultLoc = "t74";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t74 = ($t75.isCompiled ? $t75.rval : $t76);
                        VM.releaseContext();
                      case 30:
                        var $t78 = VM.getContext();

                        if ($ctx.t74.to.be)
                          $ctx.t74.to.be.$ctx = $t78;

                        $t78.softReset();
                        var $t79 = $ctx.t74.to.be(undefined);
                        $ctx.next = 39;

                        if ($t78.frame) {
                          $ctx.childFrame = $t78.frame;
                          $ctx.resultLoc = "t77";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t77 = ($t78.isCompiled ? $t78.rval : $t79);
                        VM.releaseContext();
                      case 39:
                        y = x + 5;
                        $ctx.next = 42;
                      case 42:
                        var $t81 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t81;

                        $t81.softReset();
                        var $t82 = expect(y);
                        $ctx.next = 51;

                        if ($t81.frame) {
                          $ctx.childFrame = $t81.frame;
                          $ctx.resultLoc = "t80";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t80 = ($t81.isCompiled ? $t81.rval : $t82);
                        VM.releaseContext();
                      case 51:
                        var $t84 = VM.getContext();

                        if ($ctx.t80.to.be)
                          $ctx.t80.to.be.$ctx = $t84;

                        $t84.softReset();
                        var $t85 = $ctx.t80.to.be(15);
                        $ctx.next = 60;

                        if ($t84.frame) {
                          $ctx.childFrame = $t84.frame;
                          $ctx.resultLoc = "t83";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t83 = ($t84.isCompiled ? $t84.rval : $t85);
                        VM.releaseContext();
                      default:
                      case 60:
                        $anon4.$ctx = undefined;
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

                  $ctx.frame = new $Frame(4, "$anon4", $anon4, {
                    "x": x,
                    "y": y
                  }, ["expect"], this, $ctx, $ctx.childFrame);

                  $anon4.$ctx = undefined;
                };

                $ctx.next = 3;
              case 3:
                var $t41 = VM.getContext();

                if (it)
                  it.$ctx = $t41;

                $t41.softReset();
                var $t43 = it('should assign variables', $ctx.t42);
                $ctx.next = 12;

                if ($t41.frame) {
                  $ctx.childFrame = $t41.frame;
                  $ctx.resultLoc = "t40";
                  VM.stepping = true;
                  break;
                }

                $ctx.t40 = ($t41.isCompiled ? $t41.rval : $t43);
                VM.releaseContext();
              case 12:
                $ctx.t46 = function $anon5() {
                  var x;
                  var $ctx = $anon5.$ctx;

                  if ($ctx === undefined)
                    return VM.runProgram($anon5, this, arguments);

                  $ctx.isCompiled = true;

                  if ($ctx.frame) {
                    x = $ctx.frame.scope.x;
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

                  try {
                    while (1) {
                      if (VM.hasBreakpoints && VM.machineBreaks[5][$ctx.next] !== undefined)
                        break;

                      switch ($ctx.next) {
                      case 0:
                        $ctx.t86 = 5 / 2;
                        $ctx.next = 3;
                      case 3:
                        $ctx.t87 = $ctx.t86 * 5;
                        $ctx.next = 6;
                      case 6:
                        x = 10 + $ctx.t87;
                        $ctx.next = 9;
                      case 9:
                        var $t89 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t89;

                        $t89.softReset();
                        var $t90 = expect(x);
                        $ctx.next = 18;

                        if ($t89.frame) {
                          $ctx.childFrame = $t89.frame;
                          $ctx.resultLoc = "t88";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t88 = ($t89.isCompiled ? $t89.rval : $t90);
                        VM.releaseContext();
                      case 18:
                        var $t92 = VM.getContext();

                        if ($ctx.t88.to.be)
                          $ctx.t88.to.be.$ctx = $t92;

                        $t92.softReset();
                        var $t93 = $ctx.t88.to.be(22.5);
                        $ctx.next = 27;

                        if ($t92.frame) {
                          $ctx.childFrame = $t92.frame;
                          $ctx.resultLoc = "t91";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t91 = ($t92.isCompiled ? $t92.rval : $t93);
                        VM.releaseContext();
                      default:
                      case 27:
                        $anon5.$ctx = undefined;
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

                  $ctx.frame = new $Frame(5, "$anon5", $anon5, {
                    "x": x
                  }, ["expect"], this, $ctx, $ctx.childFrame);

                  $anon5.$ctx = undefined;
                };

                $ctx.next = 15;
              case 15:
                var $t45 = VM.getContext();

                if (it)
                  it.$ctx = $t45;

                $t45.softReset();
                var $t47 = it('should work with binary operators', $ctx.t46);
                $ctx.next = 24;

                if ($t45.frame) {
                  $ctx.childFrame = $t45.frame;
                  $ctx.resultLoc = "t44";
                  VM.stepping = true;
                  break;
                }

                $ctx.t44 = ($t45.isCompiled ? $t45.rval : $t47);
                VM.releaseContext();
              case 24:
                $ctx.t50 = function $anon6() {
                  var foo;
                  var $ctx = $anon6.$ctx;

                  if ($ctx === undefined)
                    return VM.runProgram($anon6, this, arguments);

                  $ctx.isCompiled = true;

                  if ($ctx.frame) {
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

                  try {
                    while (1) {
                      if (VM.hasBreakpoints && VM.machineBreaks[6][$ctx.next] !== undefined)
                        break;

                      switch ($ctx.next) {
                      case 0:
                        foo = function foo(x) {
                          var $ctx = foo.$ctx;

                          if ($ctx === undefined)
                            return VM.runProgram(foo, this, arguments);

                          $ctx.isCompiled = true;

                          if ($ctx.frame) {
                            x = $ctx.frame.scope.x;
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

                          try {
                            while (1) {
                              if (VM.hasBreakpoints && VM.machineBreaks[7][$ctx.next] !== undefined)
                                break;

                              switch ($ctx.next) {
                              case 0:
                                $ctx.rval = x + 5;
                                delete $ctx.thrown;
                                $ctx.next = 4;
                              default:
                              case 4:
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

                          $ctx.frame = new $Frame(7, "foo", foo, {
                            "x": x
                          }, ["foo", "expect"], this, $ctx, $ctx.childFrame);

                          foo.$ctx = undefined;
                        };

                        $ctx.next = 3;
                      case 3:
                        var $t97 = VM.getContext();

                        if (foo)
                          foo.$ctx = $t97;

                        $t97.softReset();
                        var $t98 = foo(2);
                        $ctx.next = 12;

                        if ($t97.frame) {
                          $ctx.childFrame = $t97.frame;
                          $ctx.resultLoc = "t96";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t96 = ($t97.isCompiled ? $t97.rval : $t98);
                        VM.releaseContext();
                      case 12:
                        var $t95 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t95;

                        $t95.softReset();
                        var $t99 = expect($ctx.t96);
                        $ctx.next = 21;

                        if ($t95.frame) {
                          $ctx.childFrame = $t95.frame;
                          $ctx.resultLoc = "t94";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t94 = ($t95.isCompiled ? $t95.rval : $t99);
                        VM.releaseContext();
                      case 21:
                        var $t101 = VM.getContext();

                        if ($ctx.t94.to.be)
                          $ctx.t94.to.be.$ctx = $t101;

                        $t101.softReset();
                        var $t102 = $ctx.t94.to.be(7);
                        $ctx.next = 30;

                        if ($t101.frame) {
                          $ctx.childFrame = $t101.frame;
                          $ctx.resultLoc = "t100";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t100 = ($t101.isCompiled ? $t101.rval : $t102);
                        VM.releaseContext();
                      default:
                      case 30:
                        $anon6.$ctx = undefined;
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

                  $ctx.frame = new $Frame(6, "$anon6", $anon6, {
                    "foo": foo
                  }, ["expect"], this, $ctx, $ctx.childFrame);

                  $anon6.$ctx = undefined;
                };

                $ctx.next = 27;
              case 27:
                var $t49 = VM.getContext();

                if (it)
                  it.$ctx = $t49;

                $t49.softReset();
                var $t51 = it('should define functions', $ctx.t50);
                $ctx.next = 36;

                if ($t49.frame) {
                  $ctx.childFrame = $t49.frame;
                  $ctx.resultLoc = "t48";
                  VM.stepping = true;
                  break;
                }

                $ctx.t48 = ($t49.isCompiled ? $t49.rval : $t51);
                VM.releaseContext();
              case 36:
                $ctx.t54 = function $anon7() {
                  var bar, z;
                  var $ctx = $anon7.$ctx;

                  if ($ctx === undefined)
                    return VM.runProgram($anon7, this, arguments);

                  $ctx.isCompiled = true;

                  if ($ctx.frame) {
                    bar = $ctx.frame.scope.bar;
                    z = $ctx.frame.scope.z;
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

                  try {
                    while (1) {
                      if (VM.hasBreakpoints && VM.machineBreaks[8][$ctx.next] !== undefined)
                        break;

                      switch ($ctx.next) {
                      case 0:
                        bar = function bar(x) {
                          var $ctx = bar.$ctx;

                          if ($ctx === undefined)
                            return VM.runProgram(bar, this, arguments);

                          $ctx.isCompiled = true;

                          if ($ctx.frame) {
                            x = $ctx.frame.scope.x;
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

                          try {
                            while (1) {
                              if (VM.hasBreakpoints && VM.machineBreaks[9][$ctx.next] !== undefined)
                                break;

                              switch ($ctx.next) {
                              case 0:
                                $ctx.rval = function $anon8(y) {
                                  var $ctx = $anon8.$ctx;

                                  if ($ctx === undefined)
                                    return VM.runProgram($anon8, this, arguments);

                                  $ctx.isCompiled = true;

                                  if ($ctx.frame) {
                                    y = $ctx.frame.scope.y;
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

                                  try {
                                    while (1) {
                                      if (VM.hasBreakpoints && VM.machineBreaks[10][$ctx.next] !== undefined)
                                        break;

                                      switch ($ctx.next) {
                                      case 0:
                                        $ctx.rval = x + y;
                                        delete $ctx.thrown;
                                        $ctx.next = 4;
                                      default:
                                      case 4:
                                        $anon8.$ctx = undefined;
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

                                  $ctx.frame = new $Frame(10, "$anon8", $anon8, {
                                    "y": y
                                  }, ["x", "bar", "z", "expect"], this, $ctx, $ctx.childFrame);

                                  $anon8.$ctx = undefined;
                                };

                                delete $ctx.thrown;
                                $ctx.next = 4;
                              default:
                              case 4:
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

                          $ctx.frame = new $Frame(9, "bar", bar, {
                            "x": x
                          }, ["bar", "z", "expect"], this, $ctx, $ctx.childFrame);

                          bar.$ctx = undefined;
                        };

                        $ctx.next = 3;
                      case 3:
                        var $t104 = VM.getContext();

                        if (bar)
                          bar.$ctx = $t104;

                        $t104.softReset();
                        var $t105 = bar(5);
                        $ctx.next = 12;

                        if ($t104.frame) {
                          $ctx.childFrame = $t104.frame;
                          $ctx.resultLoc = "t103";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t103 = ($t104.isCompiled ? $t104.rval : $t105);
                        VM.releaseContext();
                      case 12:
                        z = $ctx.t103;
                        $ctx.next = 15;
                      case 15:
                        var $t109 = VM.getContext();

                        if (z)
                          z.$ctx = $t109;

                        $t109.softReset();
                        var $t110 = z(10);
                        $ctx.next = 24;

                        if ($t109.frame) {
                          $ctx.childFrame = $t109.frame;
                          $ctx.resultLoc = "t108";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t108 = ($t109.isCompiled ? $t109.rval : $t110);
                        VM.releaseContext();
                      case 24:
                        var $t107 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t107;

                        $t107.softReset();
                        var $t111 = expect($ctx.t108);
                        $ctx.next = 33;

                        if ($t107.frame) {
                          $ctx.childFrame = $t107.frame;
                          $ctx.resultLoc = "t106";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t106 = ($t107.isCompiled ? $t107.rval : $t111);
                        VM.releaseContext();
                      case 33:
                        var $t113 = VM.getContext();

                        if ($ctx.t106.to.be)
                          $ctx.t106.to.be.$ctx = $t113;

                        $t113.softReset();
                        var $t114 = $ctx.t106.to.be(15);
                        $ctx.next = 42;

                        if ($t113.frame) {
                          $ctx.childFrame = $t113.frame;
                          $ctx.resultLoc = "t112";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t112 = ($t113.isCompiled ? $t113.rval : $t114);
                        VM.releaseContext();
                      case 42:
                        var $t118 = VM.getContext();

                        if (z)
                          z.$ctx = $t118;

                        $t118.softReset();
                        var $t119 = z(20);
                        $ctx.next = 51;

                        if ($t118.frame) {
                          $ctx.childFrame = $t118.frame;
                          $ctx.resultLoc = "t117";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t117 = ($t118.isCompiled ? $t118.rval : $t119);
                        VM.releaseContext();
                      case 51:
                        var $t116 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t116;

                        $t116.softReset();
                        var $t120 = expect($ctx.t117);
                        $ctx.next = 60;

                        if ($t116.frame) {
                          $ctx.childFrame = $t116.frame;
                          $ctx.resultLoc = "t115";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t115 = ($t116.isCompiled ? $t116.rval : $t120);
                        VM.releaseContext();
                      case 60:
                        var $t122 = VM.getContext();

                        if ($ctx.t115.to.be)
                          $ctx.t115.to.be.$ctx = $t122;

                        $t122.softReset();
                        var $t123 = $ctx.t115.to.be(25);
                        $ctx.next = 69;

                        if ($t122.frame) {
                          $ctx.childFrame = $t122.frame;
                          $ctx.resultLoc = "t121";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t121 = ($t122.isCompiled ? $t122.rval : $t123);
                        VM.releaseContext();
                      default:
                      case 69:
                        $anon7.$ctx = undefined;
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

                  $ctx.frame = new $Frame(8, "$anon7", $anon7, {
                    "bar": bar,
                    "z": z
                  }, ["expect"], this, $ctx, $ctx.childFrame);

                  $anon7.$ctx = undefined;
                };

                $ctx.next = 39;
              case 39:
                var $t53 = VM.getContext();

                if (it)
                  it.$ctx = $t53;

                $t53.softReset();
                var $t55 = it('should close over data', $ctx.t54);
                $ctx.next = 48;

                if ($t53.frame) {
                  $ctx.childFrame = $t53.frame;
                  $ctx.resultLoc = "t52";
                  VM.stepping = true;
                  break;
                }

                $ctx.t52 = ($t53.isCompiled ? $t53.rval : $t55);
                VM.releaseContext();
              case 48:
                $ctx.t58 = function $anon9() {
                  var z, i;
                  var $ctx = $anon9.$ctx;

                  if ($ctx === undefined)
                    return VM.runProgram($anon9, this, arguments);

                  $ctx.isCompiled = true;

                  if ($ctx.frame) {
                    z = $ctx.frame.scope.z;
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

                  try {
                    while (1) {
                      if (VM.hasBreakpoints && VM.machineBreaks[11][$ctx.next] !== undefined)
                        break;

                      switch ($ctx.next) {
                      case 0:
                        z = 5;
                        $ctx.next = 3;
                      case 3:
                        i = 0;
                        $ctx.next = 6;
                      case 6:
                        if (!(i < 100)) {
                          $ctx.next = 17;
                          break;
                        }

                        $ctx.next = 9;
                      case 9:
                        z++;
                        $ctx.next = 12;
                      case 12:
                        i++;
                        $ctx.next = 6;
                      case 15:
                        $ctx.next = 6;
                        break;
                      case 17:
                        var $t125 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t125;

                        $t125.softReset();
                        var $t126 = expect(z);
                        $ctx.next = 26;

                        if ($t125.frame) {
                          $ctx.childFrame = $t125.frame;
                          $ctx.resultLoc = "t124";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t124 = ($t125.isCompiled ? $t125.rval : $t126);
                        VM.releaseContext();
                      case 26:
                        var $t128 = VM.getContext();

                        if ($ctx.t124.to.be)
                          $ctx.t124.to.be.$ctx = $t128;

                        $t128.softReset();
                        var $t129 = $ctx.t124.to.be(105);
                        $ctx.next = 35;

                        if ($t128.frame) {
                          $ctx.childFrame = $t128.frame;
                          $ctx.resultLoc = "t127";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t127 = ($t128.isCompiled ? $t128.rval : $t129);
                        VM.releaseContext();
                      default:
                      case 35:
                        $anon9.$ctx = undefined;
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

                  $ctx.frame = new $Frame(11, "$anon9", $anon9, {
                    "z": z,
                    "i": i
                  }, ["expect"], this, $ctx, $ctx.childFrame);

                  $anon9.$ctx = undefined;
                };

                $ctx.next = 51;
              case 51:
                var $t57 = VM.getContext();

                if (it)
                  it.$ctx = $t57;

                $t57.softReset();
                var $t59 = it('should work with for loops', $ctx.t58);
                $ctx.next = 60;

                if ($t57.frame) {
                  $ctx.childFrame = $t57.frame;
                  $ctx.resultLoc = "t56";
                  VM.stepping = true;
                  break;
                }

                $ctx.t56 = ($t57.isCompiled ? $t57.rval : $t59);
                VM.releaseContext();
              case 60:
                $ctx.t62 = function $anon10() {
                  var z, i;
                  var $ctx = $anon10.$ctx;

                  if ($ctx === undefined)
                    return VM.runProgram($anon10, this, arguments);

                  $ctx.isCompiled = true;

                  if ($ctx.frame) {
                    z = $ctx.frame.scope.z;
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

                  try {
                    while (1) {
                      if (VM.hasBreakpoints && VM.machineBreaks[12][$ctx.next] !== undefined)
                        break;

                      switch ($ctx.next) {
                      case 0:
                        z = 5;
                        $ctx.next = 3;
                      case 3:
                        i = 0;
                        $ctx.next = 6;
                      case 6:
                        if (!(i < 100)) {
                          $ctx.next = 17;
                          break;
                        }

                        $ctx.next = 9;
                      case 9:
                        z++;
                        $ctx.next = 12;
                      case 12:
                        i++;
                        $ctx.next = 6;
                      case 15:
                        $ctx.next = 6;
                        break;
                      case 17:
                        var $t131 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t131;

                        $t131.softReset();
                        var $t132 = expect(i);
                        $ctx.next = 26;

                        if ($t131.frame) {
                          $ctx.childFrame = $t131.frame;
                          $ctx.resultLoc = "t130";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t130 = ($t131.isCompiled ? $t131.rval : $t132);
                        VM.releaseContext();
                      case 26:
                        var $t134 = VM.getContext();

                        if ($ctx.t130.to.be)
                          $ctx.t130.to.be.$ctx = $t134;

                        $t134.softReset();
                        var $t135 = $ctx.t130.to.be(100);
                        $ctx.next = 35;

                        if ($t134.frame) {
                          $ctx.childFrame = $t134.frame;
                          $ctx.resultLoc = "t133";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t133 = ($t134.isCompiled ? $t134.rval : $t135);
                        VM.releaseContext();
                      case 35:
                        var $t137 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t137;

                        $t137.softReset();
                        var $t138 = expect(z);
                        $ctx.next = 44;

                        if ($t137.frame) {
                          $ctx.childFrame = $t137.frame;
                          $ctx.resultLoc = "t136";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t136 = ($t137.isCompiled ? $t137.rval : $t138);
                        VM.releaseContext();
                      case 44:
                        var $t140 = VM.getContext();

                        if ($ctx.t136.to.be)
                          $ctx.t136.to.be.$ctx = $t140;

                        $t140.softReset();
                        var $t141 = $ctx.t136.to.be(105);
                        $ctx.next = 53;

                        if ($t140.frame) {
                          $ctx.childFrame = $t140.frame;
                          $ctx.resultLoc = "t139";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t139 = ($t140.isCompiled ? $t140.rval : $t141);
                        VM.releaseContext();
                      case 53:
                        z = 5;
                        $ctx.next = 56;
                      case 56:
                        i = 0;
                        $ctx.next = 59;
                      case 59:
                        z++;
                        $ctx.next = 62;
                      case 62:
                        i++;
                        $ctx.next = 65;
                      case 65:
                        if (i < 200) {
                          $ctx.next = 59;
                          break;
                        }

                        $ctx.next = 68;
                      case 68:
                        var $t143 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t143;

                        $t143.softReset();
                        var $t144 = expect(i);
                        $ctx.next = 77;

                        if ($t143.frame) {
                          $ctx.childFrame = $t143.frame;
                          $ctx.resultLoc = "t142";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t142 = ($t143.isCompiled ? $t143.rval : $t144);
                        VM.releaseContext();
                      case 77:
                        var $t146 = VM.getContext();

                        if ($ctx.t142.to.be)
                          $ctx.t142.to.be.$ctx = $t146;

                        $t146.softReset();
                        var $t147 = $ctx.t142.to.be(200);
                        $ctx.next = 86;

                        if ($t146.frame) {
                          $ctx.childFrame = $t146.frame;
                          $ctx.resultLoc = "t145";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t145 = ($t146.isCompiled ? $t146.rval : $t147);
                        VM.releaseContext();
                      case 86:
                        var $t149 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t149;

                        $t149.softReset();
                        var $t150 = expect(z);
                        $ctx.next = 95;

                        if ($t149.frame) {
                          $ctx.childFrame = $t149.frame;
                          $ctx.resultLoc = "t148";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t148 = ($t149.isCompiled ? $t149.rval : $t150);
                        VM.releaseContext();
                      case 95:
                        var $t152 = VM.getContext();

                        if ($ctx.t148.to.be)
                          $ctx.t148.to.be.$ctx = $t152;

                        $t152.softReset();
                        var $t153 = $ctx.t148.to.be(205);
                        $ctx.next = 104;

                        if ($t152.frame) {
                          $ctx.childFrame = $t152.frame;
                          $ctx.resultLoc = "t151";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t151 = ($t152.isCompiled ? $t152.rval : $t153);
                        VM.releaseContext();
                      default:
                      case 104:
                        $anon10.$ctx = undefined;
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

                  $ctx.frame = new $Frame(12, "$anon10", $anon10, {
                    "z": z,
                    "i": i
                  }, ["expect"], this, $ctx, $ctx.childFrame);

                  $anon10.$ctx = undefined;
                };

                $ctx.next = 63;
              case 63:
                var $t61 = VM.getContext();

                if (it)
                  it.$ctx = $t61;

                $t61.softReset();
                var $t63 = it('should work with while loops', $ctx.t62);
                $ctx.next = 72;

                if ($t61.frame) {
                  $ctx.childFrame = $t61.frame;
                  $ctx.resultLoc = "t60";
                  VM.stepping = true;
                  break;
                }

                $ctx.t60 = ($t61.isCompiled ? $t61.rval : $t63);
                VM.releaseContext();
              case 72:
                $ctx.t66 = function $anon11() {
                  var arr, Foo, foo;
                  var $ctx = $anon11.$ctx;

                  if ($ctx === undefined)
                    return VM.runProgram($anon11, this, arguments);

                  $ctx.isCompiled = true;

                  if ($ctx.frame) {
                    arr = $ctx.frame.scope.arr;
                    Foo = $ctx.frame.scope.Foo;
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

                  try {
                    while (1) {
                      if (VM.hasBreakpoints && VM.machineBreaks[13][$ctx.next] !== undefined)
                        break;

                      switch ($ctx.next) {
                      case 0:
                        Foo = function Foo(x) {
                          var $ctx = Foo.$ctx;

                          if ($ctx === undefined)
                            return VM.runProgram(Foo, this, arguments);

                          $ctx.isCompiled = true;

                          if ($ctx.frame) {
                            x = $ctx.frame.scope.x;
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

                          try {
                            while (1) {
                              if (VM.hasBreakpoints && VM.machineBreaks[14][$ctx.next] !== undefined)
                                break;

                              switch ($ctx.next) {
                              case 0:
                                this.x = x;
                                $ctx.next = 3;
                              default:
                              case 3:
                                Foo.$ctx = undefined;
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

                          $ctx.frame = new $Frame(14, "Foo", Foo, {
                            "x": x
                          }, ["arr", "Foo", "foo", "expect"], this, $ctx, $ctx.childFrame);

                          Foo.$ctx = undefined;
                        };

                        $ctx.next = 3;
                      case 3:
                        arr = new Array(1000);
                        $ctx.next = 6;
                      case 6:
                        var $t155 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t155;

                        $t155.softReset();
                        var $t156 = expect(arr.length);
                        $ctx.next = 15;

                        if ($t155.frame) {
                          $ctx.childFrame = $t155.frame;
                          $ctx.resultLoc = "t154";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t154 = ($t155.isCompiled ? $t155.rval : $t156);
                        VM.releaseContext();
                      case 15:
                        var $t158 = VM.getContext();

                        if ($ctx.t154.to.be)
                          $ctx.t154.to.be.$ctx = $t158;

                        $t158.softReset();
                        var $t159 = $ctx.t154.to.be(1000);
                        $ctx.next = 24;

                        if ($t158.frame) {
                          $ctx.childFrame = $t158.frame;
                          $ctx.resultLoc = "t157";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t157 = ($t158.isCompiled ? $t158.rval : $t159);
                        VM.releaseContext();
                      case 24:
                        foo = new Foo(5);
                        $ctx.next = 27;
                      case 27:
                        var $t161 = VM.getContext();

                        if (expect)
                          expect.$ctx = $t161;

                        $t161.softReset();
                        var $t162 = expect(foo.x);
                        $ctx.next = 36;

                        if ($t161.frame) {
                          $ctx.childFrame = $t161.frame;
                          $ctx.resultLoc = "t160";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t160 = ($t161.isCompiled ? $t161.rval : $t162);
                        VM.releaseContext();
                      case 36:
                        var $t164 = VM.getContext();

                        if ($ctx.t160.to.be)
                          $ctx.t160.to.be.$ctx = $t164;

                        $t164.softReset();
                        var $t165 = $ctx.t160.to.be(5);
                        $ctx.next = 45;

                        if ($t164.frame) {
                          $ctx.childFrame = $t164.frame;
                          $ctx.resultLoc = "t163";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t163 = ($t164.isCompiled ? $t164.rval : $t165);
                        VM.releaseContext();
                      default:
                      case 45:
                        $anon11.$ctx = undefined;
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

                  $ctx.frame = new $Frame(13, "$anon11", $anon11, {
                    "arr": arr,
                    "Foo": Foo,
                    "foo": foo
                  }, ["expect"], this, $ctx, $ctx.childFrame);

                  $anon11.$ctx = undefined;
                };

                $ctx.next = 75;
              case 75:
                var $t65 = VM.getContext();

                if (it)
                  it.$ctx = $t65;

                $t65.softReset();
                var $t67 = it('should work with "new"', $ctx.t66);
                $ctx.next = 84;

                if ($t65.frame) {
                  $ctx.childFrame = $t65.frame;
                  $ctx.resultLoc = "t64";
                  VM.stepping = true;
                  break;
                }

                $ctx.t64 = ($t65.isCompiled ? $t65.rval : $t67);
                VM.releaseContext();
              default:
              case 84:
                $anon3.$ctx = undefined;
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

          $ctx.frame = new $Frame(3, "$anon3", $anon3, {}, ["expect"], this, $ctx, $ctx.childFrame);
          $anon3.$ctx = undefined;
        };

        $ctx.next = 27;
      case 27:
        var $t8 = VM.getContext();

        if (describe)
          describe.$ctx = $t8;

        $t8.softReset();
        var $t10 = describe('basic code', $ctx.t9);
        $ctx.next = 36;

        if ($t8.frame) {
          $ctx.childFrame = $t8.frame;
          $ctx.resultLoc = "t7";
          VM.stepping = true;
          break;
        }

        $ctx.t7 = ($t8.isCompiled ? $t8.rval : $t10);
        VM.releaseContext();
      case 36:
        $ctx.t13 = function $anon12() {
          var $ctx = $anon12.$ctx;

          if ($ctx === undefined)
            return VM.runProgram($anon12, this, arguments);

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

          try {
            while (1) {
              if (VM.hasBreakpoints && VM.machineBreaks[15][$ctx.next] !== undefined)
                break;

              switch ($ctx.next) {
              case 0:
                $ctx.t168 = function $anon13() {
                  var machine, foo;
                  var $ctx = $anon13.$ctx;

                  if ($ctx === undefined)
                    return VM.runProgram($anon13, this, arguments);

                  $ctx.isCompiled = true;

                  if ($ctx.frame) {
                    machine = $ctx.frame.scope.machine;
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

                  try {
                    while (1) {
                      if (VM.hasBreakpoints && VM.machineBreaks[16][$ctx.next] !== undefined)
                        break;

                      switch ($ctx.next) {
                      case 0:
                        foo = function foo() {
                          var x;
                          var $ctx = foo.$ctx;

                          if ($ctx === undefined)
                            return VM.runProgram(foo, this, arguments);

                          $ctx.isCompiled = true;

                          if ($ctx.frame) {
                            x = $ctx.frame.scope.x;
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

                          try {
                            while (1) {
                              if (VM.hasBreakpoints && VM.machineBreaks[17][$ctx.next] !== undefined)
                                break;

                              switch ($ctx.next) {
                              case 0:
                                x = 1;
                                $ctx.next = 3;
                              case 3:
                                VM.stepping = true;
                                $ctx.next = 6;
                              case 6:
                                var $t177 = VM.getContext();

                                if (console.log)
                                  console.log.$ctx = $t177;

                                $t177.softReset();
                                var $t178 = console.log('FOO IS RUNNING');
                                $ctx.next = 15;

                                if ($t177.frame) {
                                  $ctx.childFrame = $t177.frame;
                                  $ctx.resultLoc = "t176";
                                  VM.stepping = true;
                                  break;
                                }

                                $ctx.t176 = ($t177.isCompiled ? $t177.rval : $t178);
                                VM.releaseContext();
                              case 15:
                                x = 2;
                                $ctx.next = 18;
                              default:
                              case 18:
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

                          $ctx.frame = new $Frame(17, "foo", foo, {
                            "x": x
                          }, ["machine", "foo", "expect"], this, $ctx, $ctx.childFrame);

                          foo.$ctx = undefined;
                        };

                        $ctx.next = 3;
                      case 3:
                        machine = new $Machine();
                        $ctx.next = 6;
                      case 6:
                        var $t171 = VM.getContext();

                        if (machine.runProgram)
                          machine.runProgram.$ctx = $t171;

                        $t171.softReset();
                        var $t172 = machine.runProgram(foo);
                        $ctx.next = 15;

                        if ($t171.frame) {
                          $ctx.childFrame = $t171.frame;
                          $ctx.resultLoc = "t170";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t170 = ($t171.isCompiled ? $t171.rval : $t172);
                        VM.releaseContext();
                      case 15:
                        var $t174 = VM.getContext();

                        if (console.log)
                          console.log.$ctx = $t174;

                        $t174.softReset();
                        var $t175 = console.log(machine.rootFrame);
                        $ctx.next = 24;

                        if ($t174.frame) {
                          $ctx.childFrame = $t174.frame;
                          $ctx.resultLoc = "t173";
                          VM.stepping = true;
                          break;
                        }

                        $ctx.t173 = ($t174.isCompiled ? $t174.rval : $t175);
                        VM.releaseContext();
                      default:
                      case 24:
                        $anon13.$ctx = undefined;
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

                  $ctx.frame = new $Frame(16, "$anon13", $anon13, {
                    "machine": machine,
                    "foo": foo
                  }, ["expect"], this, $ctx, $ctx.childFrame);

                  $anon13.$ctx = undefined;
                };

                $ctx.next = 3;
              case 3:
                var $t167 = VM.getContext();

                if (it)
                  it.$ctx = $t167;

                $t167.softReset();
                var $t169 = it('should suspend on debugger', $ctx.t168);
                $ctx.next = 12;

                if ($t167.frame) {
                  $ctx.childFrame = $t167.frame;
                  $ctx.resultLoc = "t166";
                  VM.stepping = true;
                  break;
                }

                $ctx.t166 = ($t167.isCompiled ? $t167.rval : $t169);
                VM.releaseContext();
              default:
              case 12:
                $anon12.$ctx = undefined;
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

          $ctx.frame = new $Frame(15, "$anon12", $anon12, {}, ["expect"], this, $ctx, $ctx.childFrame);
          $anon12.$ctx = undefined;
        };

        $ctx.next = 39;
      case 39:
        var $t12 = VM.getContext();

        if (describe)
          describe.$ctx = $t12;

        $t12.softReset();
        var $t14 = describe('suspending', $ctx.t13);
        $ctx.next = 48;

        if ($t12.frame) {
          $ctx.childFrame = $t12.frame;
          $ctx.resultLoc = "t11";
          VM.stepping = true;
          break;
        }

        $ctx.t11 = ($t12.isCompiled ? $t12.rval : $t14);
        VM.releaseContext();
      default:
        VM.stepping = true;
        break;
      case -1:
        $ctx.rval = eval(VM.evalArg);
      }

      if (VM.stepping)
        break;
    }
  }catch (e) {
    VM.error = e;
  }

  $ctx.frame = new $Frame(0, "$__root", $__root, {
    "expect": expect
  }, [], this, $ctx, $ctx.childFrame);

  $__root.$ctx = undefined;
};


var VM = new $Machine();
VM.on("error", function(e) { throw e; });
VM.beginFunc($__root, new $DebugInfo(__debugInfo));