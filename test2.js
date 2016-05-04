
function foo(x) {
  if(x <= 0) {
    return x;
  } else {
    console.log('hi', x);
    return x + foo(x - 1);
  }
}

debugger;
console.log(foo(3));
