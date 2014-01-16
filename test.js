
function foo(x, y, z) {
  function bar(w) {
    return x + w;
  } 
}

var f = foo(1, 2, 3);
console.log(f(20));
