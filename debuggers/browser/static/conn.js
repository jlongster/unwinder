(function(exports) {

// Connection

function Connection(target, name) {
  this.target = target;
  this.baseid = 0;
  this._events = [];
  this.queue = {};
  this.name = name;

  this.handleMessage = this.handleMessage.bind(this);
  window.addEventListener('message', this.handleMessage, false);
}

Connection.prototype.kill = function() {
  window.removeEventListener('message', this.handleMessage, false);
};

Connection.prototype.send = function(msg, cb) {
  msg.from = this.baseid++;
  this.target.postMessage(msg, '*');

  if(cb) {
    this.queue[msg.from] = cb;
  }
};

Connection.prototype.handleMessage = function(msg) {
  var data = msg.data;

  if(data.to != null) {
    var handler = this.queue[data.to];
    handler.apply(this, data.result);
    delete this.queue[data.to];
  }
  else {
    var result = this.fire(data.type, data.args || [], data.from);
    if(result) {
      this.send({
        to: msg.from,
        result: result
      });
    }
  }
};

Connection.prototype.fire = function(event, args, from) {
  // Events are always fired asynchronouly
  setTimeout(function() {
    this.respond = function(res) {
      if(from) {
        this.send({ result: res, to: from });
      }
    }.bind(this);

    var arr = this._events[event] || [];
    arr.forEach(function(handler) {
      handler.apply(this, args);
    }.bind(this));

    this.respond = function() {
      throw new Error('nobody waiting for response');
    };
  }.bind(this), 0);
};

Connection.prototype.on = function(event, handler) {
  var arr = this._events[event] || [];
  arr.push(handler);
  this._events[event] = arr;
};

Connection.prototype.off = function(event, handler) {
  var arr = this._events[event] || [];
  if(handler) {
    var i = arr.indexOf(handler);
    if(i !== -1) {
      arr.splice(i, 1);
    }
  }
  else {
    this._events[event] = [];
  }
};

exports.Connection = Connection;
})(typeof module !== 'undefined' ? module.exports : this);
