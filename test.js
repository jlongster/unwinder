// Example code, see try/catch/throw implementation below

function bar(x) {
  if(x < 0) {
    Throw(new Error("error!"));
  }
  return x * 2;
}

function foo(x) {
  return bar(x);
}

function main() {
  Try(
    function() {
      console.log(foo(1));
      console.log(foo(-1));
    },
    function(ex) {
      console.log("caught", ex);
    }
  );
}

main();

// Output:
// 2
// caught [Error: error!]

// try/catch/throw implementation

var tryStack = [];

function Try(body, handler) {
  var ret;
  var exc = callCC(function(cont) {
    tryStack.push(cont);
    ret = body();
  });
  tryStack.pop();

  if(exc) {
    return handler(exc);
  }
  return ret;
}

function Throw(exc) {
  if(tryStack.length > 0) {
    tryStack[tryStack.length - 1](exc);
  }
  console.log("unhandled exception", exc);
}

