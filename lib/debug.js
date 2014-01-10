var types = require("ast-types");
var b = types.builders;

function locToSyntax(loc) {
    return b.objectExpression([
        b.property(
            'init',
            b.literal('start'),
            b.objectExpression([
                b.property(
                    'init',
                    b.literal('line'),
                    b.literal(loc.start.line)
                ),
                b.property(
                    'init',
                    b.literal('column'),
                    b.literal(loc.start.column)
                )
            ])
        ),

        b.property(
            'init',
            b.literal('end'),
            b.objectExpression([
                b.property(
                    'init',
                    b.literal('line'),
                    b.literal(loc.end.line)
                ),
                b.property(
                    'init',
                    b.literal('column'),
                    b.literal(loc.end.column)
                )
            ])
        )
    ]);
}

function DebugInfo() {
    this.baseId = 1;
    this.baseIndex = 1;
    this.machines = {};
    this.stmts = [];
}

DebugInfo.prototype.makeId = function() {
    var id = this.baseId++;
    this.machines[id] = { locs: {} };
    return id;
};

DebugInfo.prototype.resolveLoc = function(machineId, stmt, index) {
    this.stmts.some(function(s) {
        if(stmt === s) {
            this.addSourceLocation(machineId, stmt.loc, index);
            return true;
        }
    }.bind(this));
};

DebugInfo.prototype.addSourceLocation = function(machineId, loc, index) {
    this.machines[machineId].locs[index] = loc;
    return index;
};

DebugInfo.prototype.getDebugInfo = function() {
    return b.variableDeclaration(
        'var',
        [b.variableDeclarator(
            b.identifier('__debug'),
            b.objectExpression(Object.keys(this.machines).map(function(k) {
                var machine = this.machines[k];

                return b.property(
                    'init',
                    b.literal(k),
                    b.objectExpression(Object.keys(machine.locs).map(function(k) {
                        return b.property(
                            'init',
                            b.literal(k),
                            locToSyntax(machine.locs[k])
                        );
                    }))
                );
            }.bind(this)))
        )]
    );
};

exports.DebugInfo = DebugInfo;
