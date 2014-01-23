
var x = 0;
var foo;

function global(n) {
  if(n == 1) {
    function foo() {
      x++;
    }
  }
  else if(n == 2) {
    foo();
  }
  else if(n == 3) {
    eval('function foo() {' +
         ' x += 2;' +
        '}');
  }
};

global(1);
global(3);
global(2);
console.log(x);
