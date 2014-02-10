var express = require('express');

var app = express();
app.configure(function() {
  app.use(express.static(__dirname + '/static'));
  app.use(express.bodyParser());
  app.use(express.methodOverride());
});

var baseid = 0;
var processes = [];

app.get('/process/:id', function(req, res) {
  var id = req.params.id;
  res.send(processes[id]);
});

app.post('/process', function(req, res) {
  var src = req.body.src;
  processes[baseid] = src;
  res.send('' + baseid);
  baseid++;
});

app.listen(4000);
