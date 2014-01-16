/**
 * Copyright (c) 2013, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * https://raw.github.com/facebook/regenerator/master/LICENSE file. An
 * additional grant of patent rights can be found in the PATENTS file in
 * the same directory.
 */

var assert = require("assert");
var types = require("ast-types");
var isArray = types.builtInTypes.array;
var b = types.builders;
var n = types.namedTypes;
var leap = require("./leap");
var meta = require("./meta");
var hasOwn = Object.prototype.hasOwnProperty;
var withLoc = require("./util").withLoc;

function Emitter(contextId, debugId, debugInfo) {
  assert.ok(this instanceof Emitter);
  n.Identifier.assert(contextId);

  Object.defineProperties(this, {
    // In order to make sure the context object does not collide with
    // anything in the local scope, we might have to rename it, so we
    // refer to it symbolically instead of just assuming that it will be
    // called "context".
    contextId: { value: contextId },

    // An append-only list of Statements that grows each time this.emit is
    // called.
    listing: { value: [] },

    // A sparse array whose keys correspond to locations in this.listing
    // that have been marked as branch/jump targets.
    marked: { value: [true] },

    // Every location has a source location mapping
    sourceLocations: { value: [true] },

    // The last location will be marked when this.getDispatchLoop is
    // called.
    finalLoc: { value: loc() },

    debugId: { value: debugId },
    debugInfo: { value: debugInfo }
  });

  // The .leapManager property needs to be defined by a separate
  // defineProperties call so that .finalLoc will be visible to the
  // leap.LeapManager constructor.
  Object.defineProperties(this, {
    // Each time we evaluate the body of a loop, we tell this.leapManager
    // to enter a nested loop context that determines the meaning of break
    // and continue statements therein.
    leapManager: { value: new leap.LeapManager(this) }
  });
}

var Ep = Emitter.prototype;
exports.Emitter = Emitter;

// Offsets into this.listing that could be used as targets for branches or
// jumps are represented as numeric Literal nodes. This representation has
// the amazingly convenient benefit of allowing the exact value of the
// location to be determined at any time, even after generating code that
// refers to the location.
function loc() {
  var lit = b.literal(-1);
  // A little hacky, but mark is as a location object so we can do
  // some quick checking later (see resolveEmptyJumps)
  lit._location = true;
  return lit;
}

// Sets the exact value of the given location to the offset of the next
// Statement emitted.
Ep.mark = function(loc) {
  n.Literal.assert(loc);
  var index = this.listing.length;
  loc.value = index;
  this.marked[index] = true;
  return loc;
};

Ep.markAndBreak = function() {
  var next = loc();
  this.emitAssign(this.contextProperty("next"), next);
  this.emit(b.breakStatement(null), true);
  this.mark(next);
};

Ep.emit = function(node, internal) {
  if (n.Expression.check(node)) {
    node = withLoc(b.expressionStatement(node), node.loc);
  }

  n.Statement.assert(node);
  this.listing.push(node);

  if(!internal) {
    if(!node.loc) {
      throw new Error("source location missing");
    }
    else {
      this.debugInfo.addSourceLocation(this.debugId,
                                       node.loc,
                                       this.listing.length - 1);
    }
  }
};

// Shorthand for emitting assignment statements. This will come in handy
// for assignments to temporary variables.
Ep.emitAssign = function(lhs, rhs, loc) {
  this.emit(this.assign(lhs, rhs, loc), !loc);
  return lhs;
};

// Shorthand for an assignment statement.
Ep.assign = function(lhs, rhs, loc) {
  var node = b.expressionStatement(
    b.assignmentExpression("=", lhs, rhs));
  node.loc = loc;
  return node;
};

// Convenience function for generating expressions like context.next,
// context.sent, and context.rval.
Ep.contextProperty = function(name, loc) {
  var node = b.memberExpression(
    this.contextId,
    b.identifier(name),
    false
  );
  node.loc = loc;
  return node;
};

Ep.declareVar = function(name, init, loc) {
  return withLoc(b.variableDeclaration(
    'var',
    [b.variableDeclarator(b.identifier(name), init)]
  ), loc);
};

Ep.getProperty = function(obj, prop, computed, loc) {
  return withLoc(b.memberExpression(
    typeof obj === 'string' ? b.identifier(obj) : obj,
    typeof prop === 'string' ? b.identifier(prop) : prop,
    !!computed
  ), loc);
};

Ep.vmProperty = function(name, loc) {
  var node = b.memberExpression(
    b.identifier('VM'),
    b.identifier(name),
    false
  );
  node.loc = loc;
  return node;
};

var volatileContextPropertyNames = {
  next: true,
  sent: true,
  rval: true,
  thrown: true
};

// A "volatile" context property is a MemberExpression like context.sent
// that should probably be stored in a temporary variable when there's a
// possibility the property will get overwritten.
Ep.isVolatileContextProperty = function(expr) {
  if (n.MemberExpression.check(expr)) {
    if (expr.computed) {
      // If it's a computed property such as context[couldBeAnything],
      // assume the worst in terms of volatility.
      return true;
    }

    if (n.Identifier.check(expr.object) &&
        n.Identifier.check(expr.property) &&
        expr.object.name === this.contextId.name &&
        hasOwn.call(volatileContextPropertyNames,
                    expr.property.name)) {
      return true;
    }
  }

  return false;
};

// Shorthand for setting context.rval and jumping to `context.stop()`.
Ep.stop = function(rval) {
  if (rval) {
    this.setReturnValue(rval);
  }

  this.jump(this.finalLoc);
};

Ep.setReturnValue = function(valuePath, loc) {
  n.Expression.assert(valuePath.value);

  if(!loc) {
    throw new Error("source location missing");
  }

  this.emitAssign(
    this.contextProperty("rval"),
    this.explodeExpression(valuePath),
    loc
  );
};

Ep.clearPendingException = function(assignee) {
  var cp = this.contextProperty("thrown");

  if (assignee) {
    this.emitAssign(assignee, cp);
  }

  this.emit(b.unaryExpression("delete", cp), true);
};

// Emits code for an unconditional jump to the given location, even if the
// exact value of the location is not yet known.
Ep.jump = function(toLoc) {
  this.emitAssign(this.contextProperty("next"), toLoc);
  this.emit(b.breakStatement(), true);
};

// Conditional jump.
Ep.jumpIf = function(test, toLoc, srcLoc) {
  n.Expression.assert(test);
  n.Literal.assert(toLoc);

  this.emit(withLoc(b.ifStatement(
    test,
    b.blockStatement([
      this.assign(this.contextProperty("next"), toLoc),
      b.breakStatement()
    ])
  ), srcLoc));
};

// Conditional jump, with the condition negated.
Ep.jumpIfNot = function(test, toLoc, srcLoc) {
  n.Expression.assert(test);
  n.Literal.assert(toLoc);

  this.emit(withLoc(b.ifStatement(
    b.unaryExpression("!", test),
    b.blockStatement([
      this.assign(this.contextProperty("next"), toLoc),
      b.breakStatement()
    ])
  ), srcLoc));
};

// Returns a unique MemberExpression that can be used to store and
// retrieve temporary values. Since the object of the member expression is
// the context object, which is presumed to coexist peacefully with all
// other local variables, and since we just increment `nextTempId`
// monotonically, uniqueness is assured.
var nextTempId = 0;
Ep.makeTempVar = function() {
  return this.contextProperty("t" + nextTempId++);
};

Ep.makeTempId = function() {
    return b.identifier("$t" + nextTempId++)
};

Ep.getMachine = function(funcName, varNames, scope) {
  return {
    contextId: this.contextId.name,
    ast: this.getDispatchLoop(funcName, varNames, scope)
  };
};

Ep.resolveEmptyJumps = function() {
  var self = this;
  var forwards = {};

  self.listing.forEach(function(stmt, i) {
    if(self.marked.hasOwnProperty(i) &&
       self.marked.hasOwnProperty(i + 2) &&
       (n.ReturnStatement.check(self.listing[i + 1]) ||
        n.BreakStatement.check(self.listing[i + 1])) &&
       n.ExpressionStatement.check(stmt) &&
       n.AssignmentExpression.check(stmt.expression) &&
       n.MemberExpression.check(stmt.expression.left) &&
       stmt.expression.left.object.name == '$ctx' &&
       stmt.expression.left.property.name == 'next') {

      forwards[i] = stmt.expression.right.value;
      // TODO: actually remove these cases from the output
    }
  });

  types.traverse(self.listing, function(node) {
    if(n.Literal.check(node) &&
       node._location &&
       forwards.hasOwnProperty(node.value)) {
      node.value = forwards[node.value];
    }
  });
};

// Turns this.listing into a loop of the form
//
//   while (1) switch (context.next) {
//   case 0:
//   ...
//   case n:
//     return context.stop();
//   }
//
// Each marked location in this.listing will correspond to one generated
// case statement.
Ep.getDispatchLoop = function(funcName, varNames, scope) {
  var self = this;
  var cases = [];
  var current;

  // If we encounter a break, continue, or return statement in a switch
  // case, we can skip the rest of the statements until the next case.
  var alreadyEnded = false;

  // If a case statement will just forward to another location, make
  // the original loc jump straight to it
  self.resolveEmptyJumps();

  self.listing.forEach(function(stmt, i) {
    if (self.marked.hasOwnProperty(i)) {
      cases.push(b.switchCase(
        b.literal(i),
        current = []
      ));
      alreadyEnded = false;
    }

    if (!alreadyEnded) {
      current.push(stmt);
      if (isSwitchCaseEnder(stmt))
        alreadyEnded = true;
    }
  });

  // Now that we know how many statements there will be in this.listing,
  // we can finally resolve this.finalLoc.value.
  this.finalLoc.value = this.listing.length;
  this.debugInfo.addFinalLocation(this.debugId, this.finalLoc.value);

  cases.push(
    b.switchCase(this.finalLoc, [
      // This will check/clear both context.thrown and context.rval.
      b.returnStatement(
        b.callExpression(this.contextProperty("stop"), [])
      )
    ])
  );

  // add an "eval" location
  cases.push(
    b.switchCase(b.literal(-1), [
      self.assign(
        self.contextProperty('rval'),
        b.callExpression(
          b.identifier('eval'),
          [self.vmProperty('evalArg')]
        )
      )
    ])
  );

  // restoring a frame
  var restoration = varNames.map(function(v) {
    return b.expressionStatement(
      b.assignmentExpression(
        '=',
        b.identifier(v),
        self.getProperty(
          self.getProperty(self.contextProperty('frame'), 'scope'), v
        )
      )
    );
  }).concat([
    self.declareVar('$child', self.getProperty(self.contextProperty('frame'), 'child')),
    b.ifStatement(
      b.identifier('$child'),
      b.blockStatement([
        self.declareVar('$child$ctx', self.getProperty('$child', 'ctx')),
        self.assign(self.getProperty(self.getProperty('$child', 'fn'), '$ctx'),
                    b.identifier('$child$ctx')),
        b.expressionStatement(
          b.callExpression(
            self.getProperty(self.getProperty('$child', 'fn'), 'call'),
            [self.getProperty('$child', 'thisPtr')]
          )
        ),

        b.ifStatement(
          self.getProperty('$child$ctx', 'frame'),
          b.blockStatement([
            self.assign(self.getProperty(self.contextProperty('frame'), 'child'),
                        self.getProperty('$child$ctx', 'frame')),
            b.returnStatement(null)
          ]),
          b.blockStatement([
            self.assign(self.getProperty('$ctx', 'frame'), b.literal(null)),
            self.assign(self.getProperty('$ctx', 'childFrame'), b.literal(null)),
            self.assign(self.getProperty('$ctx',
                                         self.contextProperty('resultLoc'),
                                         true),
                        self.getProperty('$child$ctx', 'rval')),
            // if we are stepping, stop executing here so that it
            // pauses on the "return" instruction
            b.ifStatement(self.vmProperty('stepping'),
                          b.throwStatement(b.literal(null)))
          ])
        )
      ]),
      b.blockStatement([
        b.ifStatement(
          self.contextProperty('staticBreakpoint'),
          self.assign(
            self.getProperty('$ctx', 'next'),
            b.binaryExpression('+', self.getProperty('$ctx', 'next'), b.literal(3))
          )
        ),
        self.assign(self.getProperty('$ctx', 'frame'), b.literal(null)),
        self.assign(self.getProperty('$ctx', 'childFrame'), b.literal(null))
      ])
    )
  ]);

  return [
    // the state machine, wrapped in a try/catch
    b.tryStatement(
      b.blockStatement([
        b.ifStatement(
          self.contextProperty('frame'),
          b.blockStatement(restoration),
          b.ifStatement(
            // if we are stepping, stop executing so it is stopped at
            // the first instruction of the new frame
            self.vmProperty('stepping'),
            b.throwStatement(b.literal(null))
          )
        ),

        b.whileStatement(
          b.literal(1),
          b.blockStatement([
            b.ifStatement(
              b.logicalExpression(
                '&&',
                self.vmProperty('hasBreakpoints'),
                b.binaryExpression(
                  '!==',
                  self.getProperty(
                    self.getProperty(self.vmProperty('machineBreaks'),
                                     b.literal(this.debugId),
                                     true),
                    self.contextProperty('next'),
                    true
                  ),
                  // is identifier right here? it doesn't seem right
                  b.identifier('undefined')
                )
              ),
              b.breakStatement()
            ),

            b.switchStatement(self.contextProperty('next'), cases),

            b.ifStatement(
              self.vmProperty('stepping'),
              b.breakStatement()
            )
          ])
        )
      ]),
      b.catchClause(b.identifier('e'), null, b.blockStatement([
        b.expressionStatement(
          b.assignmentExpression(
            '=',
            b.memberExpression(b.identifier('VM'), b.identifier('error'), false),
            b.identifier('e')
          )
        )
      ]))
    ),

    // if it falls out of the loops, that means we've paused so create
    // a frame
    b.expressionStatement(
      b.assignmentExpression(
        '=',
        self.contextProperty('frame'),
        b.newExpression(
          self.vmProperty('Frame'),
          [b.literal(this.debugId),
           b.literal(funcName),
           b.identifier(funcName),
           b.objectExpression(
             varNames.map(function(name) {
               return b.property(
                 'init',
                 b.literal(name),
                 b.identifier(name)
               );
             })
           ),
           b.arrayExpression(scope.map(function(v) { return b.literal(v); })),
           b.thisExpression(),
           b.identifier('$ctx'),
           self.contextProperty('childFrame')]
        )
      )
    )];
};

// See comment above re: alreadyEnded.
function isSwitchCaseEnder(stmt) {
  return n.BreakStatement.check(stmt)
    || n.ContinueStatement.check(stmt)
    || n.ReturnStatement.check(stmt)
    || n.ThrowStatement.check(stmt);
}

// All side effects must be realized in order.

// If any subexpression harbors a leap, all subexpressions must be
// neutered of side effects.

// No destructive modification of AST nodes.

Ep.explode = function(path, ignoreResult) {
  assert.ok(path instanceof types.NodePath);

  var node = path.value;
  var self = this;

  n.Node.assert(node);

  if (n.Statement.check(node))
    return self.explodeStatement(path);

  if (n.Expression.check(node))
    return self.explodeExpression(path, ignoreResult);

  if (n.Declaration.check(node))
    throw getDeclError(node);

  switch (node.type) {
  case "Program":
    return path.get("body").map(
      self.explodeStatement,
      self
    );

  case "VariableDeclarator":
    throw getDeclError(node);

    // These node types should be handled by their parent nodes
    // (ObjectExpression, SwitchStatement, and TryStatement, respectively).
  case "Property":
  case "SwitchCase":
  case "CatchClause":
    throw new Error(
      node.type + " nodes should be handled by their parents");

  default:
    throw new Error(
      "unknown Node of type " +
        JSON.stringify(node.type));
  }
};

function getDeclError(node) {
  return new Error(
    "all declarations should have been transformed into " +
      "assignments before the Exploder began its work: " +
      JSON.stringify(node));
}

Ep.explodeStatement = function(path, labelId) {
  assert.ok(path instanceof types.NodePath);

  var stmt = path.value;
  var self = this;

  n.Statement.assert(stmt);

  if (labelId) {
    n.Identifier.assert(labelId);
  } else {
    labelId = null;
  }

  // Explode BlockStatement nodes even if they do not contain a yield,
  // because we don't want or need the curly braces.
  if (n.BlockStatement.check(stmt)) {
    return path.get("body").each(
      self.explodeStatement,
      self
    );
  }

  // if (!meta.containsLeap(stmt)) {
  //   // Technically we should be able to avoid emitting the statement
  //   // altogether if !meta.hasSideEffects(stmt), but that leads to
  //   // confusing generated code (for instance, `while (true) {}` just
  //   // disappears) and is probably a more appropriate job for a dedicated
  //   // dead code elimination pass.
  //   self.emit(stmt);
  //   return;
  // }

  switch (stmt.type) {
  case "ExpressionStatement":
    self.explodeExpression(path.get("expression"), true);
    break;

  case "LabeledStatement":
    self.explodeStatement(path.get("body"), stmt.label);
    break;

  case "WhileStatement":
    var before = loc();
    var after = loc();

    self.mark(before);
    self.jumpIfNot(self.explodeExpression(path.get("test")),
                   after,
                   path.get("test").node.loc);

    self.markAndBreak();

    self.leapManager.withEntry(
      new leap.LoopEntry(after, before, labelId),
      function() { self.explodeStatement(path.get("body")); }
    );
    self.jump(before);
    self.mark(after);

    break;

  case "DoWhileStatement":
    var first = loc();
    var test = loc();
    var after = loc();

    self.mark(first);
    self.leapManager.withEntry(
      new leap.LoopEntry(after, test, labelId),
      function() { self.explode(path.get("body")); }
    );
    self.mark(test);
    self.jumpIf(self.explodeExpression(path.get("test")),
                first,
                path.get("test").node.loc);
    self.emitAssign(self.contextProperty('next'), after);
    self.emit(b.breakStatement(), true);
    self.mark(after);

    break;

  case "ForStatement":
    var head = loc();
    var update = loc();
    var after = loc();

    if (stmt.init) {
      // We pass true here to indicate that if stmt.init is an expression
      // then we do not care about its result.
      self.explode(path.get("init"), true);
    }

    self.mark(head);

    if (stmt.test) {
      self.jumpIfNot(self.explodeExpression(path.get("test")),
                     after,
                     path.get("test").node.loc);
    } else {
      // No test means continue unconditionally.
    }

    this.markAndBreak();

    self.leapManager.withEntry(
      new leap.LoopEntry(after, update, labelId),
      function() { self.explodeStatement(path.get("body")); }
    );

    self.mark(update);

    if (stmt.update) {
      // We pass true here to indicate that if stmt.update is an
      // expression then we do not care about its result.
      self.explode(path.get("update"), true);
    }

    self.jump(head);

    self.mark(after);

    break;

  case "ForInStatement":
    n.Identifier.assert(stmt.left);

    var head = loc();
    var after = loc();

    // var keysPath = new types.NodePath(b.callExpression(
    //   self.contextProperty("keys"),
    //   [stmt.right]
    // ), path, "right");

    var keys = self.emitAssign(
      self.makeTempVar(),
      b.callExpression(
        self.contextProperty("keys"),
        [self.explodeExpression(path.get("right"))]
      ),
      path.get("right").node.loc
    );

    var tmpLoc = loc();
    self.mark(tmpLoc);

    self.mark(head);

    self.jumpIfNot(
      b.memberExpression(
        keys,
        b.identifier("length"),
        false
      ),
      after,
      stmt.right.loc
    );

    self.emitAssign(
      stmt.left,
      b.callExpression(
        b.memberExpression(
          keys,
          b.identifier("pop"),
          false
        ),
        []
      ),
      stmt.left.loc
    );

    self.markAndBreak();

    self.leapManager.withEntry(
      new leap.LoopEntry(after, head, labelId),
      function() { self.explodeStatement(path.get("body")); }
    );

    self.jump(head);

    self.mark(after);

    break;

  case "BreakStatement":
    self.leapManager.emitBreak(stmt.label);
    break;

  case "ContinueStatement":
    self.leapManager.emitContinue(stmt.label);
    break;

  case "SwitchStatement":
    // Always save the discriminant into a temporary variable in case the
    // test expressions overwrite values like context.sent.
    var disc = self.emitAssign(
      self.makeTempVar(),
      self.explodeExpression(path.get("discriminant"))
    );

    var after = loc();
    var defaultLoc = loc();
    var condition = defaultLoc;
    var caseLocs = [];

    // If there are no cases, .cases might be undefined.
    var cases = stmt.cases || [];

    for (var i = cases.length - 1; i >= 0; --i) {
      var c = cases[i];
      n.SwitchCase.assert(c);

      if (c.test) {
        condition = b.conditionalExpression(
          b.binaryExpression("===", disc, c.test),
          caseLocs[i] = loc(),
          condition
        );
      } else {
        caseLocs[i] = defaultLoc;
      }
    }

    self.jump(self.explodeExpression(
      new types.NodePath(condition, path, "discriminant")
    ));

    self.leapManager.withEntry(
      new leap.SwitchEntry(after),
      function() {
        path.get("cases").each(function(casePath) {
          var c = casePath.value;
          var i = casePath.name;

          self.mark(caseLocs[i]);

          casePath.get("consequent").each(
            self.explodeStatement,
            self
          );
        });
      }
    );

    self.mark(after);
    if (defaultLoc.value === -1) {
      self.mark(defaultLoc);
      assert.strictEqual(after.value, defaultLoc.value);
    }

    break;

  case "IfStatement":
    var elseLoc = stmt.alternate && loc();
    var after = loc();

    self.jumpIfNot(
      self.explodeExpression(path.get("test")),
      elseLoc || after,
      path.get("test").node.loc
    );

    self.markAndBreak();

    self.explodeStatement(path.get("consequent"));

    if (elseLoc) {
      self.jump(after);
      self.mark(elseLoc);
      self.explodeStatement(path.get("alternate"));
    }

    self.mark(after);

    break;

  case "ReturnStatement":
    self.leapManager.emitReturn(path.get("argument"), path.node.loc);
    break;

  case "WithStatement":
    throw new Error(
      node.type + " not supported in generator functions.");

  case "TryStatement":
    var after = loc();

    var handler = stmt.handler;
    if (!handler && stmt.handlers) {
      handler = stmt.handlers[0] || null;
    }

    var catchLoc = handler && loc();
    var catchEntry = catchLoc && new leap.CatchEntry(
      catchLoc,
      handler.param
    );

    var finallyLoc = stmt.finalizer && loc();
    var finallyEntry = finallyLoc && new leap.FinallyEntry(
      finallyLoc,
      self.makeTempVar()
    );

    if (finallyEntry) {
      // Finally blocks examine their .nextLocTempVar property to figure
      // out where to jump next, so we must set that property to the
      // fall-through location, by default.
      self.emitAssign(finallyEntry.nextLocTempVar, after);
    }

    var tryEntry = new leap.TryEntry(catchEntry, finallyEntry);

    // Push information about this try statement so that the runtime can
    // figure out what to do if it gets an uncaught exception.
    self.pushTry(tryEntry);

    self.leapManager.withEntry(tryEntry, function() {
      self.explodeStatement(path.get("block"));

      if (catchLoc) {
        // If execution leaves the try block normally, the associated
        // catch block no longer applies.
        self.popCatch(catchEntry);

        if (finallyLoc) {
          // If we have both a catch block and a finally block, then
          // because we emit the catch block first, we need to jump over
          // it to the finally block.
          self.jump(finallyLoc);

        } else {
          // If there is no finally block, then we need to jump over the
          // catch block to the fall-through location.
          self.jump(after);
        }

        self.mark(catchLoc);

        // On entering a catch block, we must not have exited the
        // associated try block normally, so we won't have called
        // context.popCatch yet.  Call it here instead.
        self.popCatch(catchEntry);

        var bodyPath = path.get("handler", "body");
        var safeParam = self.makeTempVar();
        self.clearPendingException(safeParam);

        var catchScope = bodyPath.scope;
        var catchParamName = handler.param.name;
        n.CatchClause.assert(catchScope.node);
        assert.strictEqual(catchScope.lookup(catchParamName), catchScope);

        types.traverse(bodyPath, function(node) {
          if (n.Identifier.check(node) &&
              node.name === catchParamName &&
              this.scope.lookup(catchParamName) === catchScope) {
            this.replace(safeParam);
            return false;
          }
        });

        self.leapManager.withEntry(catchEntry, function() {
          self.explodeStatement(bodyPath);
        });
      }

      if (finallyLoc) {
        self.mark(finallyLoc);

        self.popFinally(finallyEntry);

        self.leapManager.withEntry(finallyEntry, function() {
          self.explodeStatement(path.get("finalizer"));
        });

        self.jump(finallyEntry.nextLocTempVar);
      }
    });

    self.mark(after);

    break;

  case "ThrowStatement":
    self.emit(b.throwStatement(
      self.explodeExpression(path.get("argument"))
    ));

    break;

  case "DebuggerStatement":
    var after = loc();
    self.emitAssign(self.vmProperty('stepping'),
                    b.literal(true),
                    path.node.loc);
    self.emitAssign(self.contextProperty('next'), after);
    self.emit(b.breakStatement(), true);
    self.mark(after);

    break;

  default:
    throw new Error(
      "unknown Statement of type " +
        JSON.stringify(stmt.type));
  }
};

// Emit a runtime call to context.pushTry(catchLoc, finallyLoc) so that
// the runtime wrapper can dispatch uncaught exceptions appropriately.
Ep.pushTry = function(tryEntry) {
  assert.ok(tryEntry instanceof leap.TryEntry);

  var nil = b.literal(null);
  var catchEntry = tryEntry.catchEntry;
  var finallyEntry = tryEntry.finallyEntry;
  var method = this.contextProperty("pushTry");
  var args = [
    catchEntry && catchEntry.firstLoc || nil,
    finallyEntry && finallyEntry.firstLoc || nil,
    finallyEntry && b.literal(
      finallyEntry.nextLocTempVar.property.name
    ) || nil
  ];

  this.emit(b.callExpression(method, args));
};

// Emit a runtime call to context.popCatch(catchLoc) so that the runtime
// wrapper knows when a catch block reported to pushTry no longer applies.
Ep.popCatch = function(catchEntry) {
  var catchLoc;

  if (catchEntry) {
    assert.ok(catchEntry instanceof leap.CatchEntry);
    catchLoc = catchEntry.firstLoc;
  } else {
    assert.strictEqual(catchEntry, null);
    catchLoc = b.literal(null);
  }

  // TODO Think about not emitting anything when catchEntry === null.  For
  // now, emitting context.popCatch(null) is good for sanity checking.

  this.emit(b.callExpression(
    this.contextProperty("popCatch"),
    [catchLoc]
  ));
};

// Emit a runtime call to context.popFinally(finallyLoc) so that the
// runtime wrapper knows when a finally block reported to pushTry no
// longer applies.
Ep.popFinally = function(finallyEntry) {
  var finallyLoc;

  if (finallyEntry) {
    assert.ok(finallyEntry instanceof leap.FinallyEntry);
    finallyLoc = finallyEntry.firstLoc;
  } else {
    assert.strictEqual(finallyEntry, null);
    finallyLoc = b.literal(null);
  }

  // TODO Think about not emitting anything when finallyEntry === null.
  // For now, emitting context.popFinally(null) is good for sanity
  // checking.

  this.emit(b.callExpression(
    this.contextProperty("popFinally"),
    [finallyLoc]
  ));
};

Ep.explodeExpression = function(path, ignoreResult) {
  assert.ok(path instanceof types.NodePath);

  var expr = path.value;
  if (expr) {
    n.Expression.assert(expr);
  } else {
    return expr;
  }

  var self = this;
  var result; // Used optionally by several cases below.

  function finish(expr) {
    n.Expression.assert(expr);
    if (ignoreResult) {
      var after = loc();
      self.emit(expr);
      self.emitAssign(self.contextProperty("next"), after, expr.loc);
      self.emit(b.breakStatement(), true);
      self.mark(after);
    } else {
      return expr;
    }
  }

  // If the expression does not contain a leap, then we either emit the
  // expression as a standalone statement or return it whole.
  // if (!meta.containsLeap(expr)) {
  //   return finish(expr);
  // }

  // If any child contains a leap (such as a yield or labeled continue or
  // break statement), then any sibling subexpressions will almost
  // certainly have to be exploded in order to maintain the order of their
  // side effects relative to the leaping child(ren).
  var hasLeapingChildren = meta.containsLeap.onlyChildren(expr);

  // an "atomic" expression is one that should execute within one step
  // of the VM
  function isAtomic(expr) {
    return n.Literal.check(expr) ||
      n.Identifier.check(expr) ||
      n.ThisExpression.check(expr) ||
      (n.MemberExpression.check(expr) &&
       !expr.computed);
  }

  // In order to save the rest of explodeExpression from a combinatorial
  // trainwreck of special cases, explodeViaTempVar is responsible for
  // deciding when a subexpression needs to be "exploded," which is my
  // very technical term for emitting the subexpression as an assignment
  // to a temporary variable and the substituting the temporary variable
  // for the original subexpression. Think of exploded view diagrams, not
  // Michael Bay movies. The point of exploding subexpressions is to
  // control the precise order in which the generated code realizes the
  // side effects of those subexpressions.
  function explodeViaTempVar(tempVar, childPath, ignoreChildResult) {
    assert.ok(childPath instanceof types.NodePath);

    assert.ok(
      !ignoreChildResult || !tempVar,
      "Ignoring the result of a child expression but forcing it to " +
        "be assigned to a temporary variable?"
    );

    var result = self.explodeExpression(childPath, ignoreChildResult);

    if(isAtomic(result)) {
      // don't create a new "mark" for any "atomic" expressions
      return result;
    }
    else if (!ignoreChildResult) {
      // always explode!
      result = self.emitAssign(
        tempVar || self.makeTempVar(),
        result,
        childPath.node.loc
      );

      self.markAndBreak();
    }
    return result;
  }

  // If ignoreResult is true, then we must take full responsibility for
  // emitting the expression with all its side effects, and we should not
  // return a result.

  switch (expr.type) {
  case "MemberExpression":
    return finish(withLoc(b.memberExpression(
      self.explodeExpression(path.get("object")),
      expr.computed
        ? explodeViaTempVar(null, path.get("property"))
        : expr.property,
      expr.computed
    ), path.node.loc));

  case "CallExpression":
    var oldCalleePath = path.get("callee");
    var newCallee = self.explodeExpression(oldCalleePath);

    var after = loc();
    var tmp = self.makeTempVar();
    //var prevContext = self.makeTempId();
    var curContext = self.getProperty(newCallee, '$ctx');
    var curContextTmp = self.makeTempId();
    var args = path.get("arguments").map(function(argPath) {
      return explodeViaTempVar(null, argPath);
    });

    self.emit(
      withLoc(self.declareVar(
        curContextTmp.name, 
        b.callExpression(self.getProperty('VM', 'getContext'), [])
      ), path.node.loc)
    );

    self.emit(
      b.ifStatement(
        newCallee,
        self.assign(curContext, curContextTmp)
      ),
      true
    );

    self.emit(b.callExpression(
      self.getProperty(curContextTmp, 'softReset'),
      []
    ), true);

    var res = self.makeTempId();
    
    self.emit(self.declareVar(res.name, b.callExpression(newCallee, args)),
              true);
    self.emitAssign(self.contextProperty("next"), after);

    self.emit(
      b.ifStatement(
        self.getProperty(curContextTmp, 'frame'),
        b.blockStatement([
          b.expressionStatement(
            b.assignmentExpression(
              '=',
              self.contextProperty('childFrame'),
              self.getProperty(curContextTmp, 'frame')
            )
          ),
          b.expressionStatement(
            b.assignmentExpression(
              '=',
              self.contextProperty('resultLoc'),
              b.literal(tmp.property.name)
            )
          ),
          b.expressionStatement(
            b.assignmentExpression('=',
                                   self.vmProperty('stepping'),
                                   b.literal(true))
          ),
          b.breakStatement()
        ])
      ),
      true
    );

    self.emitAssign(
      tmp,
      b.conditionalExpression(
        self.getProperty(curContextTmp, 'isCompiled'),
        self.getProperty(curContextTmp, 'rval'),
        res
      )
    );

    // self.emitAssign(curContext, prevContext);
    self.emit(b.callExpression(self.getProperty('VM', 'releaseContext') ,[]),
              true);

    self.emit(b.breakStatement(), true);
    self.mark(after);
    return tmp;

  case "NewExpression":
    // TODO: this should be the last major expression type I need to
    // fix up to be able to trace/step through. can't call native new
    return finish(b.newExpression(
      explodeViaTempVar(null, path.get("callee")),
      path.get("arguments").map(function(argPath) {
        return explodeViaTempVar(null, argPath);
      })
    ));

  case "ObjectExpression":
    return finish(b.objectExpression(
      path.get("properties").map(function(propPath) {
        return b.property(
          propPath.value.kind,
          propPath.value.key,
          explodeViaTempVar(null, propPath.get("value"))
        );
      })
    ));

  case "ArrayExpression":
    return finish(b.arrayExpression(
      path.get("elements").map(function(elemPath) {
        return explodeViaTempVar(null, elemPath);
      })
    ));

  case "SequenceExpression":
    var lastIndex = expr.expressions.length - 1;

    path.get("expressions").each(function(exprPath) {
      if (exprPath.name === lastIndex) {
        result = self.explodeExpression(exprPath, ignoreResult);
      } else {
        self.explodeExpression(exprPath, true);
      }
    });

    return result;

  case "LogicalExpression":
    var after = loc();

    if (!ignoreResult) {
      result = self.makeTempVar();
    }

    var left = explodeViaTempVar(result, path.get("left"));

    if (expr.operator === "&&") {
      self.jumpIfNot(left, after);
    } else if (expr.operator = "||") {
      self.jumpIf(left, after);
    }

    explodeViaTempVar(result, path.get("right"), ignoreResult);

    self.mark(after);

    return result;

  case "ConditionalExpression":
    var elseLoc = loc();
    var after = loc();
    var test = self.explodeExpression(path.get("test"));

    self.jumpIfNot(test, elseLoc);

    if (!ignoreResult) {
      result = self.makeTempVar();
    }

    explodeViaTempVar(result, path.get("consequent"), ignoreResult);
    self.jump(after);

    self.mark(elseLoc);
    explodeViaTempVar(result, path.get("alternate"), ignoreResult);

    self.mark(after);

    return result;

  case "UnaryExpression":
    return finish(withLoc(b.unaryExpression(
      expr.operator,
      // Can't (and don't need to) break up the syntax of the argument.
      // Think about delete a[b].
      self.explodeExpression(path.get("argument")),
      !!expr.prefix
    ), path.node.loc));

  case "BinaryExpression":
    return finish(withLoc(b.binaryExpression(
      expr.operator,
      explodeViaTempVar(null, path.get("left")),
      explodeViaTempVar(null, path.get("right"))
    ), path.node.loc));

  case "AssignmentExpression":
    return finish(withLoc(b.assignmentExpression(
      expr.operator,
      self.explodeExpression(path.get("left")),
      self.explodeExpression(path.get("right"))
    ), path.node.loc));

  case "UpdateExpression":
    return finish(withLoc(b.updateExpression(
      expr.operator,
      self.explodeExpression(path.get("argument")),
      expr.prefix
    ), expr.loc));

  case "YieldExpression":
    var after = loc();
    var arg = expr.argument && self.explodeExpression(path.get("argument"));

    if (arg && expr.delegate) {
      var result = self.makeTempVar();

      self.emit(b.returnStatement(b.callExpression(
        self.contextProperty("delegateYield"), [
          arg,
          b.literal(result.property.name),
          after
        ]
      )));

      self.mark(after);

      return result;
    }

    self.emitAssign(self.contextProperty("next"), after);
    self.emit(b.returnStatement(arg || null));
    self.mark(after);

    return self.contextProperty("sent");

  case "FunctionExpression":
  case "ThisExpression":
  case "Identifier":
  case "Literal":
    return finish(expr);
    break;

  default:
    throw new Error(
      "unknown Expression of type " +
        JSON.stringify(expr.type));
  }
};
