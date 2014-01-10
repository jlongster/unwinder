
__debug_sourceURL="test.js";
// function bar(i) {
//     if(i > 0) {
//         return i + bar(i - 1);
//     }
//     return 0;
// }

(function(global) {
    var hasOwn = Object.prototype.hasOwnProperty;
    var util = require('util');

    // debugger 

    setTimeout(function() { util.print('> ') }, 1000);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', function(text) {
        setTimeout(function() { util.print('> ') }, 100);

        text = text.trim();
        
        switch(text) {
        case 'stack':
            console.log('*** stack:\n' + curFrame.getStack().split('\n').map(function(s) {
                return '  ' + s;
            }).join('\n'));
            break;
        case 'c':
            if(VM_STATE == VM_STATE_SUSPENDED) {
                rootFrame.run();
            }
            break;
        case 's':
            if(VM_STATE == VM_STATE_SUSPENDED) {
                curFrame.step();
            }
            break;
        default:
            console.log('*** invalid command');
        }
    });

    // vm

    function invokeRoot(fn, self) {
        rootFrame = curFrame = fn();
        rootFrame.run();
    }

    function invokeFunction(name, id, fn, self) {
        return new Frame(name, id, fn, self);
    }

    global.invokeFunction = invokeFunction;
    global.invokeRoot = invokeRoot;

    if(typeof exports !== 'undefined') {
        exports.invokeFunction = invokeFunction;
        exports.invokeRoot = invokeRoot;
    }

    var originalSrc = require('fs').readFileSync(__debug_sourceURL, 'utf8').split('\n');

    var UndefinedValue = Object.create(null);
    var rootFrame;
    var curFrame;
    var nextFrame;

    var VM_STATE;
    var VM_STATE_SUSPENDED = 'suspended';
    var VM_STATE_ENDED = 'ended';
    var VM_STATE_EXECUTING = 'executing';

    function Frame(name, machineId, fn, self) {
        var context = new Context();
        this.self = self;
        this.fn = fn;
        this.name = name;
        this.machineId = machineId;

        this.run = function() {
            VM_STATE = VM_STATE_EXECUTING;
            context.state = 'executing';

            while(VM_STATE === VM_STATE_EXECUTING) {
                curFrame.invoke();
            }
        };

        this.invoke = function() {
            context.debugIdx = null;
            var value = fn.call(self, context);

            if(context.state === 'suspended') {
                console.log('suspended: ' + this.getExpression());
                VM_STATE = VM_STATE_SUSPENDED;
            }
            else {
                this.invokeEnd();
            }
        };

        this.invokeEnd = function() {
            if(context.invoke) {
                var frame = context.invoke;
                context.invoke = null;

                frame.parent = this;
                curFrame = frame;
                curFrame.setState(context.state);
            }
            else if(!this.parent) {
                VM_STATE = VM_STATE_ENDED;
            }
            else if(context.rval !== UndefinedValue) {
                // something was returned
                var val = context.rval;
                context.rval = UndefinedValue;
                curFrame = this.parent;
                curFrame.return(val);
            }
        };

        this.step = function() {
            this.invokeEnd();
            curFrame.invoke();
        };

        this.return = function(val) {
            context.returned = val;
        };

        this.setState = function(state) {
            context.state = state;
        };

        this.getStack = function() {
            if(!this.parent) {
                return this.getExpression();
            }
            else {
                return this.getExpression() + '\n' + this.parent.getStack();
            }
        };

        this.getExpression = function() {
            console.log(this.machineId, context.debugIdx || context.next);
            var loc = __debug[this.machineId][context.debugIdx || context.next];
            var line = originalSrc[loc.start.line - 1];
            return line.slice(loc.start.column, loc.end.column);
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

            return this.rval;
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

var __debug = {
        "1": {
            "3": {
                "start": {
                    "line": 18,
                    "column": 12
                },

                "end": {
                    "line": 18,
                    "column": 17
                }
            },

            "6": {
                "start": {
                    "line": 18,
                    "column": 12
                },

                "end": {
                    "line": 18,
                    "column": 19
                }
            },

            "9": {
                "start": {
                    "line": 18,
                    "column": 0
                },

                "end": {
                    "line": 18,
                    "column": 20
                }
            }
        },

        "2": {
            "3": {
                "start": {
                    "line": 12,
                    "column": 8
                },

                "end": {
                    "line": 12,
                    "column": 13
                }
            },

            "6": {
                "start": {
                    "line": 12,
                    "column": 15
                },

                "end": {
                    "line": 12,
                    "column": 20
                }
            },

            "9": {
                "start": {
                    "line": 12,
                    "column": 22
                },

                "end": {
                    "line": 12,
                    "column": 27
                }
            }
        }
    }

invokeRoot(function() {
    var foo;

    return invokeFunction("\u003Canon\u003E", 1, function($ctx) {
        do switch ($ctx.next) {
        case 0:
            $ctx.next = 3;

            foo = function foo() {
                var x, y, z;

                return invokeFunction("foo", 2, function foo$($ctx) {
                    do switch ($ctx.next) {
                    case 0:
                        $ctx.next = 3;
                        $ctx.state = "suspended";
                        return;
                    case 3:
                        $ctx.next = 6;
                        x = 5;
                        return;
                    case 6:
                        $ctx.next = 9;
                        y = 6;
                        return;
                    case 9:
                        $ctx.next = 12;
                        z = 7;
                        return;
                    case 12:
                    case "end":
                        return $ctx.stop();
                    } while ($ctx.state === "executing");
                }, this);
            };

            return;
        case 3:
            $ctx.invoke = foo();
            $ctx.next = 6;
            return;
        case 6:
            $ctx.invoke = (0, $ctx.returned)();
            $ctx.next = 9;
            return;
        case 9:
            $ctx.invoke = console.log($ctx.returned);
            $ctx.next = 12;
            return;
        case 12:
        case "end":
            return $ctx.stop();
        } while ($ctx.state === "executing");
    }, this);
}, this);
