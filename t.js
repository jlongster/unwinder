

function main(restore) {
  var x;

  if(restore) {
    x = restore.x;
  }

  function foo() {
    console.log(x);
    x++;
  }

  if(restore) {
    eval(restore.expr);
  }
  else {
    x = 0;
    foo();
    foo();
    foo();
  }

  console.log('EXITING: ' + x);
  return x;
}

var restore = {
  x: main(),
  expr: 'foo()'
}

main(restore);
