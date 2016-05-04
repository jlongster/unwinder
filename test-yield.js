
var yieldStack = [];

function currentContinuation() {
  return callCC(function(cont) {
    cont(cont);
  });
}

function Run(fn) {
  let c = currentContinuation();
  let y;

  if(c) {
    y = {
      suspend: c,
      send: function(val) {
        if(!y.finished) {
          let c = currentContinuation();
          if(c) {
            y.suspend = c;
            y.resume(val);
          }
        }
      }
    };

    yieldStack.push(y);
    fn();
    yieldStack.pop();
    y.finished = true;
    // A final suspend will jump back to the last place where we
    // should be (either the last thing that sent a value or, if
    // nothing was ever sent, ourselves)
    y.suspend();
  }

  return y;
}

function Yield() {
  if(yieldStack.length > 0) {
    var c = currentContinuation();
    var y = yieldStack[yieldStack.length - 1];
    if(typeof c === 'function') {
      y.resume = c;
      y.suspend();
    }
    else {
      y.resume = null;
      return c;
    }
  }
  throw new Error("Yield outside of Run");
}

// Example code, see below for run/yield implementation. Note how we
// can even do yields across the stack, so this implements something
// more like coroutines than generators.

function foo() {
  while(1) {
    console.log(Yield());
  }
}

var process = Run(function() {
  foo();
});

process.send("hello");
process.send(5);
process.send(10);
process.send(5);
process.send(10);
process.send(5);
process.send(10);
process.send(5);
process.send(10);

// Output:
// hello
// 6
