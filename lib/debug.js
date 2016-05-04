var types = require("ast-types");
var recast = require("recast");
var b = types.builders;

function DebugInfo() {
  this.baseId = 0;
  this.baseIndex = 1;
  this.machines = [];
  this.stepIds = [];
  this.stmts = [];
}

DebugInfo.prototype.makeId = function() {
  var id = this.baseId++;
  this.machines[id] = {
    locs: {},
    finalLoc: null
  };
  return id;
};

DebugInfo.prototype.addStepIds = function(machineId, ids) {
  this.stepIds[machineId] = ids;
}

DebugInfo.prototype.addSourceLocation = function(machineId, loc, index) {
  this.machines[machineId].locs[index] = loc;
  return index;
};

DebugInfo.prototype.getSourceLocation = function(machineId, index) {
  return this.machines[machineId].locs[index];
};

DebugInfo.prototype.addFinalLocation = function(machineId, loc) {
  this.machines[machineId].finalLoc = loc;
};

DebugInfo.prototype.getDebugAST = function() {
  const ast = recast.parse('(' + JSON.stringify(
    { machines: this.machines,
      stepIds: this.stepIds }
  ) + ')');

  return b.variableDeclaration(
    'var',
    [b.variableDeclarator(
      b.identifier('__debugInfo'),
      ast.program.body[0].expression)]
  );
};

DebugInfo.prototype.getDebugInfo = function() {
  return { machines: this.machines,
           stepIds: this.stepIds };
};

exports.DebugInfo = DebugInfo;
