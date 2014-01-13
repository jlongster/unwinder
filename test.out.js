
__debug_sourceURL="test.js";
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

        console.log(meta);
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

VM.setDebugInfo({
    "1": {
        "finalLoc": 21,

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

            "18": {
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
    },

    "2": {
        "finalLoc": 20,

        "locs": {
            "0": {
                "start": {
                    "line": 3,
                    "column": 8
                },

                "end": {
                    "line": 3,
                    "column": 13
                }
            },

            "1": {
                "start": {
                    "line": 3,
                    "column": 8
                },

                "end": {
                    "line": 3,
                    "column": 13
                }
            },

            "3": {
                "start": {
                    "line": 4,
                    "column": 8
                },

                "end": {
                    "line": 4,
                    "column": 28
                }
            },

            "4": {
                "start": {
                    "line": 4,
                    "column": 8
                },

                "end": {
                    "line": 4,
                    "column": 28
                }
            },

            "6": {
                "start": {
                    "line": 5,
                    "column": 17
                },

                "end": {
                    "line": 5,
                    "column": 20
                }
            },

            "7": {
                "start": {
                    "line": 5,
                    "column": 17
                },

                "end": {
                    "line": 5,
                    "column": 20
                }
            },

            "8": {
                "start": {
                    "line": 5,
                    "column": 12
                },

                "end": {
                    "line": 5,
                    "column": 13
                }
            },

            "11": {
                "start": {
                    "line": 6,
                    "column": 8
                },

                "end": {
                    "line": 6,
                    "column": 19
                }
            },

            "12": {
                "start": {
                    "line": 6,
                    "column": 8
                },

                "end": {
                    "line": 6,
                    "column": 19
                }
            },

            "16": {
                "start": {
                    "line": 8,
                    "column": 4
                },

                "end": {
                    "line": 8,
                    "column": 13
                }
            }
        }
    },

    "3": {
        "finalLoc": 24,

        "locs": {
            "0": {
                "start": {
                    "line": 12,
                    "column": 8
                },

                "end": {
                    "line": 12,
                    "column": 14
                }
            },

            "1": {
                "start": {
                    "line": 12,
                    "column": 8
                },

                "end": {
                    "line": 12,
                    "column": 14
                }
            },

            "3": {
                "start": {
                    "line": 13,
                    "column": 12
                },

                "end": {
                    "line": 13,
                    "column": 15
                }
            },

            "4": {
                "start": {
                    "line": 13,
                    "column": 12
                },

                "end": {
                    "line": 13,
                    "column": 15
                }
            },

            "6": {
                "start": {
                    "line": 13,
                    "column": 17
                },

                "end": {
                    "line": 13,
                    "column": 20
                }
            },

            "9": {
                "start": {
                    "line": 14,
                    "column": 8
                },

                "end": {
                    "line": 14,
                    "column": 13
                }
            },

            "10": {
                "start": {
                    "line": 14,
                    "column": 8
                },

                "end": {
                    "line": 14,
                    "column": 13
                }
            },

            "12": {
                "start": {
                    "line": 13,
                    "column": 22
                },

                "end": {
                    "line": 13,
                    "column": 25
                }
            },

            "13": {
                "start": {
                    "line": 13,
                    "column": 22
                },

                "end": {
                    "line": 13,
                    "column": 25
                }
            },

            "17": {
                "start": {
                    "line": 16,
                    "column": 11
                },

                "end": {
                    "line": 16,
                    "column": 18
                }
            },

            "20": {
                "start": {
                    "line": 16,
                    "column": 4
                },

                "end": {
                    "line": 16,
                    "column": 19
                }
            }
        }
    },

    "4": {
        "finalLoc": 17,

        "locs": {
            "0": {
                "start": {
                    "line": 20,
                    "column": 8
                },

                "end": {
                    "line": 20,
                    "column": 14
                }
            },

            "1": {
                "start": {
                    "line": 20,
                    "column": 8
                },

                "end": {
                    "line": 20,
                    "column": 14
                }
            },

            "3": {
                "start": {
                    "line": 22,
                    "column": 8
                },

                "end": {
                    "line": 22,
                    "column": 13
                }
            },

            "4": {
                "start": {
                    "line": 22,
                    "column": 8
                },

                "end": {
                    "line": 22,
                    "column": 13
                }
            },

            "6": {
                "start": {
                    "line": 23,
                    "column": 8
                },

                "end": {
                    "line": 23,
                    "column": 11
                }
            },

            "7": {
                "start": {
                    "line": 23,
                    "column": 8
                },

                "end": {
                    "line": 23,
                    "column": 11
                }
            },

            "9": {
                "start": {
                    "line": 24,
                    "column": 12
                },

                "end": {
                    "line": 24,
                    "column": 17
                }
            },

            "10": {
                "start": {
                    "line": 26,
                    "column": 11
                },

                "end": {
                    "line": 26,
                    "column": 20
                }
            },

            "13": {
                "start": {
                    "line": 26,
                    "column": 4
                },

                "end": {
                    "line": 26,
                    "column": 21
                }
            }
        }
    },

    "5": {
        "finalLoc": 20,

        "locs": {
            "0": {
                "start": {
                    "line": 30,
                    "column": 7
                },

                "end": {
                    "line": 30,
                    "column": 12
                }
            },

            "3": {
                "start": {
                    "line": 31,
                    "column": 15
                },

                "end": {
                    "line": 31,
                    "column": 24
                }
            },

            "6": {
                "start": {
                    "line": 31,
                    "column": 31
                },

                "end": {
                    "line": 31,
                    "column": 36
                }
            },

            "9": {
                "start": {
                    "line": 31,
                    "column": 27
                },

                "end": {
                    "line": 31,
                    "column": 37
                }
            },

            "12": {
                "start": {
                    "line": 31,
                    "column": 8
                },

                "end": {
                    "line": 31,
                    "column": 38
                }
            },

            "16": {
                "start": {
                    "line": 33,
                    "column": 4
                },

                "end": {
                    "line": 33,
                    "column": 13
                }
            }
        }
    },

    "6": {
        "finalLoc": 7,

        "locs": {
            "0": {
                "start": {
                    "line": 37,
                    "column": 11
                },

                "end": {
                    "line": 37,
                    "column": 21
                }
            },

            "3": {
                "start": {
                    "line": 37,
                    "column": 4
                },

                "end": {
                    "line": 37,
                    "column": 22
                }
            }
        }
    }
});

invokeRoot(function $anon1() {
    var quux, mumble, baz, bar, foo;
    var $ctx = $anon1.$ctx;
    $ctx.isCompiled = true;

    do switch ($ctx.next) {
    case 0:
        quux = function quux(i) {
            var z, obj, k;
            var $ctx = quux.$ctx;
            $ctx.isCompiled = true;

            do switch ($ctx.next) {
            case 0:
                z = 1;
                $ctx.next = 3;
                return;
            case 3:
                obj = {
                    x: 1,
                    y: 2
                };

                $ctx.next = 6;
                return;
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
                return;
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
            } while ($ctx.state === 3);
        };

        $ctx.next = 3;
        return;
    case 3:
        mumble = function mumble(i) {
            var z, j;
            var $ctx = mumble.$ctx;
            $ctx.isCompiled = true;

            do switch ($ctx.next) {
            case 0:
                z = 10;
                $ctx.next = 3;
                return;
            case 3:
                j = 0;
                $ctx.next = 6;
                return;
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
                return;
            case 12:
                j++;
                $ctx.next = 6;
                return;
            case 15:
                $ctx.next = 6;
                break;
            case 17:
                $ctx.invoke = ["quux", null, quux, z];
                $ctx.next = 20;
                return;
            case 20:
                $ctx.rval = $ctx.returned;
                delete $ctx.thrown;
                $ctx.next = 24;
                break;
            case 24:
                return $ctx.stop();
            } while ($ctx.state === 3);
        };

        $ctx.next = 6;
        return;
    case 6:
        baz = function baz(i) {
            var j;
            var $ctx = baz.$ctx;
            $ctx.isCompiled = true;

            do switch ($ctx.next) {
            case 0:
                j = 10;
                $ctx.next = 3;
                return;
            case 3:
                j = 5;
                $ctx.next = 6;
                return;
            case 6:
                i--;
                $ctx.next = 9;
                return;
            case 9:
                if (i > 0) {
                    $ctx.next = 3;
                    break;
                }
            case 10:
                $ctx.invoke = ["mumble", null, mumble, j];
                $ctx.next = 13;
                return;
            case 13:
                $ctx.rval = $ctx.returned;
                delete $ctx.thrown;
                $ctx.next = 17;
                break;
            case 17:
                return $ctx.stop();
            } while ($ctx.state === 3);
        };

        $ctx.next = 9;
        return;
    case 9:
        bar = function bar(i) {
            var $ctx = bar.$ctx;
            $ctx.isCompiled = true;

            do switch ($ctx.next) {
            case 0:
                if (!(i > 0)) {
                    $ctx.next = 16;
                    break;
                }

                $ctx.next = 3;
                break;
            case 3:
                $ctx.invoke = ["mumble", null, mumble, i];
                $ctx.next = 6;
                return;
            case 6:
                $ctx.t1 = i - 1;
                $ctx.next = 9;
                break;
            case 9:
                $ctx.invoke = ["bar", null, bar, $ctx.t1];
                $ctx.next = 12;
                return;
            case 12:
                $ctx.rval = $ctx.returned + $ctx.returned;
                delete $ctx.thrown;
                $ctx.next = 20;
                break;
            case 16:
                $ctx.rval = 0;
                delete $ctx.thrown;
                $ctx.next = 20;
                break;
            case 20:
                return $ctx.stop();
            } while ($ctx.state === 3);
        };

        $ctx.next = 12;
        return;
    case 12:
        foo = function foo2() {
            var $ctx = foo2.$ctx;
            $ctx.isCompiled = true;

            do switch ($ctx.next) {
            case 0:
                $ctx.invoke = ["bar", null, bar, 10000];
                $ctx.next = 3;
                return;
            case 3:
                $ctx.rval = $ctx.returned;
                delete $ctx.thrown;
                $ctx.next = 7;
                break;
            case 7:
                return $ctx.stop();
            } while ($ctx.state === 3);
        };

        $ctx.next = 15;
        return;
    case 15:
        console.error(foo);
        $ctx.invoke = ["foo", null, foo];
        $ctx.next = 18;
        return;
    case 18:
        $ctx.invoke = ["console.log", console, console.log, $ctx.returned];
        $ctx.next = 21;
        return;
    case 21:
        return $ctx.stop();
    } while ($ctx.state === 3);
}, this);
