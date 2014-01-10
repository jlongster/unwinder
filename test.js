
// function bar(i) {
//     if(i > 0) {
//         return i + bar(i - 1);
//     }
//     return 0;
// }

function foo() {
    debugger;

    var x = 5, y = 6, z = 7;
    // var y = bar(x);

    // return function() { return y; };
}

console.log(foo()());
