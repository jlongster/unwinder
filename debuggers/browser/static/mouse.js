var prevMouse = null;

window.onmousemove = function(e) {
  e.preventDefault();

  var mouse = [e.pageX / renderer.scale,
               e.pageY / renderer.scale];

  if(prevMouse) {
    var diff = [mouse[0] - prevMouse[0], mouse[1] - prevMouse[1]];
    var d = Math.sqrt(diff[0] * diff[0] + diff[1] * diff[1]);

    for(var i=0; i<d; i+=1) {
      mousemove(prevMouse[0] + diff[0] * (i / d),
                prevMouse[1] + diff[1] * (i / d));
    }
  }

  mousemove(mouse[0], mouse[1]);
  prevMouse = mouse;
};


var mouseInfluenceSize = 10;
var mouseInfluenceScalar = 8;
var lastMouse = [0, 0];
function mousemove(x, y) {
  for(var i=0; i<entities.length; i++) {
    if(entities[i].pinned) {
      continue;
    }

    var pos = entities[i].pos;
    var line = [pos[0] - x, pos[1] - y];
    var dist = Math.sqrt(line[0]*line[0] + line[1]*line[1]);

    if(dist < mouseInfluenceSize) {
      renderer.fadeIn();

      entities[i].lastPos[0] =
        (entities[i].pos[0] -
         (x - lastMouse[0]) * mouseInfluenceScalar);

      entities[i].lastPos[1] =
        (entities[i].pos[1] -
         (y - lastMouse[1]) * mouseInfluenceScalar);
    }
  }

  lastMouse = [x, y];
}
