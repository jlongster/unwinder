
var canvas = document.querySelector('canvas');
var ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

var x = 0;
var start = Date.now();

function render() {
  var now = Date.now() - start;
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  var h = canvas.height / 2;
  
  for(var i=0; i<1000; i++) {
    ctx.fillStyle = 'green';
    ctx.fillRect(i, Math.sin(i / 100 + now / 30) * h + h, 3, 3);
  }
  
  x += 1;
  
  requestAnimationFrame(render);
}

render();
