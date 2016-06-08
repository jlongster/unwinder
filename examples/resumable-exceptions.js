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
    return callCC(function(cont) {
      exc.__cont = cont;
      tryStack[tryStack.length - 1](exc);
    });
  }
  throw exc;
}

function Resume(exc, value) {
  exc.__cont(value);
}

// Example 1

function times2(x) {
  console.log('x is', x);
  if(x < 0) {
    Throw(new Error("error!"));
  }
  return x * 2;
}

function main(x) {
  return times2(x);
}

Try(
  function() {
    console.log(main(1));
    console.log(main(-1));
  },
  function(ex) {
    Resume(ex);
  }
);

// Example 2

// Try(
//   function() {
//     Throw("from body");
//   },
//   function(ex) {
//     console.log("caught:", ex);
//     Throw("unhandled");
//   }
// );

// Example 3
// Try(
//   function() {
//     Try(
//       function() {
//         Throw("from body");
//       },
//       function(exc) {
//         console.log("caught:", exc);
//         Throw("from inner");
//       }
//     )
//   },
//   function(exc) {
//     console.log("outer caught:", exc);
//   }
// );


// function bar(x) {
//   if(x < 0) {
//     x = Throw({ BAD_NUMBER: x });
//   }
//   return x * 2;
// }

// function foo(x) {
//   return bar(x);
// }

// function main() {
//   Try(
//     function() {
//       console.log(foo(-2));
//     },
//     function(ex) {
//       if(ex.BAD_NUMBER === -2) {
//         Resume(ex, 2);
//       }
//       console.log("caught", ex);
//     }
//   );
// }

// main();
