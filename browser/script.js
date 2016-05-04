function foo(x) {
  if(x < 2) {
    debugger;
  }
  return x + foo(x - 1);
}

foo(10);
