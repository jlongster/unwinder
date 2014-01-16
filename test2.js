

function mumble(i) {
  var z = 10;
  for(var j=1; j<=i; j++) {
    debugger;
    z *= j;
  }
  return z;
}

console.log(mumble(5));
