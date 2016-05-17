/**
 * Copyright (c) 2013, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * https://raw.github.com/facebook/regenerator/master/LICENSE file. An
 * additional grant of patent rights can be found in the PATENTS file in
 * the same directory.
 */
"use strict";

var assert = require("assert");
var types = require("ast-types");
var recast = require("recast");
var isArray = types.builtInTypes.array;
var b = types.builders;
var n = types.namedTypes;
var leap = require("./leap");
var meta = require("./meta");
var hasOwn = Object.prototype.hasOwnProperty;
var withLoc = require("./util").withLoc;

function makeASTGenerator(code) {
  return function() {
    // TODO: optimize it so it doesn't always have to parse it
    var ast = b.blockStatement(recast.parse(code).program.body);
    var args = arguments;
    return types.traverse(ast, function(node) {
      if(n.Identifier.check(node) &&
         node.name[0] === '$') {
        var idx = parseInt(node.name.slice(1));
        return this.replace(args[idx - 1]);
      }
    });
  }
}

var makeSetBreakpointAST = makeASTGenerator('VM.hasBreakpoints = true;\nVM.machineBreaks[$1][$2] = true;');

function Emitter(debugId, debugInfo) {
  assert.ok(this instanceof Emitter);

  this.tmpId = 0;
  this.maxTmpId = 0;

  Object.defineProperties(this, {
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

Ep.getLastMark = function() {
  var index = this.listing.length;
  while(index > 0 && !this.marked[index]) {
    index--;
  }
  return index;
};

Ep.markAndBreak = function() {
  var next = loc();
  this.emitAssign(b.identifier('$__next'), next);
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
      throw new Error("source location missing: " + JSON.stringify(node));
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

Ep.clearPendingException = function(assignee, loc) {
  var cp = this.vmProperty("error");

  if(assignee) {
    this.emitAssign(assignee, cp, loc);
  }

  this.emitAssign(cp, b.literal(null));
};

// Emits code for an unconditional jump to the given location, even if the
// exact value of the location is not yet known.
Ep.jump = function(toLoc) {
  this.emitAssign(b.identifier('$__next'), toLoc);
  this.emit(b.breakStatement(), true);
};

// Conditional jump.
Ep.jumpIf = function(test, toLoc, srcLoc) {
  n.Expression.assert(test);
  n.Literal.assert(toLoc);

  this.emit(withLoc(b.ifStatement(
    test,
    b.blockStatement([
      this.assign(b.identifier('$__next'), toLoc),
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
      this.assign(b.identifier('$__next'), toLoc),
      b.breakStatement()
    ])
  ), srcLoc));
};

// Make temporary ids. They should be released when not needed anymore
// so that we can generate as few of them as possible.
Ep.getTempVar = function() {
  this.tmpId++;
  if(this.tmpId > this.maxTmpId) {
    this.maxTmpId = this.tmpId;
  }
  return b.identifier("$__t" + this.tmpId);
};

Ep.currentTempId = function() {
  return this.tmpId;
};

Ep.releaseTempVar = function() {
  this.tmpId--;
};

Ep.numTempVars = function() {
  return this.maxTmpId;
};

Ep.withTempVars = function(cb) {
  var prevId = this.tmpId;
  var res = cb();
  this.tmpId = prevId;
  return res;
};

Ep.getMachine = function(funcName, varNames) {
  return this.getDispatchLoop(funcName, varNames);
};

Ep.resolveEmptyJumps = function() {
  var self = this;
  var forwards = {};

  // TODO: this is actually broken now since we removed the $ctx
  // variable
  self.listing.forEach(function(stmt, i) {
    if(self.marked.hasOwnProperty(i) &&
       self.marked.hasOwnProperty(i + 2) &&
       (n.ReturnStatement.check(self.listing[i + 1]) ||
        n.BreakStatement.check(self.listing[i + 1])) &&
       n.ExpressionStatement.check(stmt) &&
       n.AssignmentExpression.check(stmt.expression) &&
       n.MemberExpression.check(stmt.expression.left) &&
       stmt.expression.left.object.name == '$ctx' &&
       stmt.expression.left.property.name == '$__next') {

      forwards[i] = stmt.expression.right;
      // TODO: actually remove these cases from the output
    }
  });

  types.traverse(self.listing, function(node) {
    if(n.Literal.check(node) &&
       node._location &&
       forwards.hasOwnProperty(node.value)) {
      this.replace(forwards[node.value]);
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
Ep.getDispatchLoop = function(funcName, varNames) {
  var self = this;

  // If we encounter a break, continue, or return statement in a switch
  // case, we can skip the rest of the statements until the next case.
  var alreadyEnded = false, current, cases = [];

  // If a case statement will just forward to another location, make
  // the original loc jump straight to it
  self.resolveEmptyJumps();

  self.listing.forEach(function(stmt, i) {
    if (self.marked.hasOwnProperty(i)) {
      cases.push(b.switchCase(
        b.literal(i),
        current = []));
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
  this.debugInfo.addStepIds(this.debugId, this.marked.reduce((acc, val, i) => {
    if(val) {
      acc.push(i);
    }
    return acc;
  }, []));;

  cases.push.apply(cases, [
    b.switchCase(null, []),
    b.switchCase(this.finalLoc, [
      b.returnStatement(null)
    ])
  ]);

  // add an "eval" location
  cases.push(
    b.switchCase(b.literal(-1), [
      self.assign(
        self.vmProperty('evalResult'),
        b.callExpression(
          b.identifier('eval'),
          [self.vmProperty('evalArg')]
        )
      ),
      b.throwStatement(
        b.newExpression(b.identifier('$ContinuationExc'), [])
      )
    ])
  );

  return [
    // the state machine
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
                b.identifier('$__next'),
                true
              ),
              // is identifier right here? it doesn't seem right
              b.identifier('undefined')
            )
          ),
          b.throwStatement(
            b.newExpression(b.identifier('$ContinuationExc'), [])
          )
        ),

        b.switchStatement(b.identifier('$__next'), cases),

        b.ifStatement(
          self.vmProperty('stepping'),
          b.throwStatement(
            b.newExpression(b.identifier('$ContinuationExc'), [])
          )
        )
      ])
    )
  ];
};

// See comment above re: alreadyEnded.
function isSwitchCaseEnder(stmt) {
  return n.BreakStatement.check(stmt)
    || n.ContinueStatement.check(stmt)
    || n.ReturnStatement.check(stmt)
    || n.ThrowStatement.check(stmt);
}

// an "atomic" expression is one that should execute within one step
// of the VM
function isAtomic(expr) {
  return n.Literal.check(expr) ||
    n.Identifier.check(expr) ||
    n.ThisExpression.check(expr) ||
    (n.MemberExpression.check(expr) &&
     !expr.computed);
}

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
    self.emitAssign(b.identifier('$__next'), after);
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

    var keys = self.emitAssign(
      self.getTempVar(),
      b.callExpression(
        self.vmProperty("keys"),
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
    self.releaseTempVar();

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
      self.getTempVar(),
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

    self.releaseTempVar();
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
    var arg = path.get('argument');

    var tmp = self.getTempVar();
      var after = loc();
    self.emitAssign(b.identifier('$__next'), after, arg.node.loc);
    self.emitAssign(
      tmp,
      this.explodeExpression(arg)
    );
    // TODO: breaking here allowing stepping to stop on return.
    // Not sure if that's desirable or not.
    // self.emit(b.breakStatement(), true);
    self.mark(after);
    self.releaseTempVar();

    self.emit(withLoc(b.returnStatement(tmp), path.node.loc));
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
      self.getTempVar()
    );

    if (finallyEntry) {
      // Finally blocks examine their .nextLocTempVar property to figure
      // out where to jump next, so we must set that property to the
      // fall-through location, by default.
      self.emitAssign(finallyEntry.nextLocTempVar, after, path.node.loc);
    }

    var tryEntry = new leap.TryEntry(catchEntry, finallyEntry);

    // Push information about this try statement so that the runtime can
    // figure out what to do if it gets an uncaught exception.
    self.pushTry(tryEntry, path.node.loc);
    self.markAndBreak();

    self.leapManager.withEntry(tryEntry, function() {
      self.explodeStatement(path.get("block"));

      if (catchLoc) {
        // If execution leaves the try block normally, the associated
        // catch block no longer applies.
        self.popCatch(catchEntry, handler.loc);

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
        self.popCatch(catchEntry, handler.loc);
        // self.markAndBreak();

        var bodyPath = path.get("handler", "body");
        var safeParam = self.getTempVar();
        self.clearPendingException(safeParam, handler.loc);
        self.markAndBreak();

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

        self.releaseTempVar();
      }

      if (finallyLoc) {
        self.mark(finallyLoc);

        self.popFinally(finallyEntry, stmt.finalizer.loc);
        self.markAndBreak();

        self.leapManager.withEntry(finallyEntry, function() {
          self.explodeStatement(path.get("finalizer"));
        });

        self.jump(finallyEntry.nextLocTempVar);
        self.releaseTempVar();
      }
    });

    self.mark(after);

    break;

  case "ThrowStatement":
    self.emit(withLoc(b.throwStatement(
      self.explodeExpression(path.get("argument"))
    ), path.node.loc));

    break;

  case "DebuggerStatement":
    var after = loc();
    self.emit(makeSetBreakpointAST(b.literal(this.debugId), after), true);
    self.emitAssign(b.identifier('$__next'), after);
    self.emit(b.breakStatement(), true);
    self.mark(after);

    after = loc();
    self.emitAssign(b.identifier('$__next'), after, path.node.loc);
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
Ep.pushTry = function(tryEntry, loc) {
  assert.ok(tryEntry instanceof leap.TryEntry);

  var nil = b.literal(null);
  var catchEntry = tryEntry.catchEntry;
  var finallyEntry = tryEntry.finallyEntry;
  var method = this.vmProperty("pushTry");
  var args = [
    b.identifier('tryStack'),
    catchEntry && catchEntry.firstLoc || nil,
    finallyEntry && finallyEntry.firstLoc || nil,
    finallyEntry && b.literal(
      parseInt(finallyEntry.nextLocTempVar.name.replace('$__t', ''))
    ) || nil
  ];

  this.emit(withLoc(b.callExpression(method, args), loc));
};

// Emit a runtime call to context.popCatch(catchLoc) so that the runtime
// wrapper knows when a catch block reported to pushTry no longer applies.
Ep.popCatch = function(catchEntry, loc) {
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

  this.emit(withLoc(b.callExpression(
    this.vmProperty("popCatch"),
    [b.identifier('tryStack'), catchLoc]
  ), loc));
};

// Emit a runtime call to context.popFinally(finallyLoc) so that the
// runtime wrapper knows when a finally block reported to pushTry no
// longer applies.
Ep.popFinally = function(finallyEntry, loc) {
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

  this.emit(withLoc(b.callExpression(
    this.vmProperty("popFinally"),
    [b.identifier('tryStack'), finallyLoc]
  ), loc));
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
      self.emitAssign(b.identifier('$__next'), after);
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

  // In order to save the rest of explodeExpression from a combinatorial
  // trainwreck of special cases, explodeViaTempVar is responsible for
  // deciding when a subexpression needs to be "exploded," which is my
  // very technical term for emitting the subexpression as an assignment
  // to a temporary variable and the substituting the temporary variable
  // for the original subexpression. Think of exploded view diagrams, not
  // Michael Bay movies. The point of exploding subexpressions is to
  // control the precise order in which the generated code realizes the
  // side effects of those subexpressions.
  function explodeViaTempVar(tempVar, childPath, ignoreChildResult, keepTempVar) {
    assert.ok(childPath instanceof types.NodePath);
    assert.ok(
      !ignoreChildResult || !tempVar,
      "Ignoring the result of a child expression but forcing it to " +
        "be assigned to a temporary variable?"
    );

    if(isAtomic(childPath.node)) {
      // we still explode it because only the top-level expression is
      // atomic, sub-expressions may not be
      return self.explodeExpression(childPath, ignoreChildResult);
    }
    else if (!ignoreChildResult) {
      var shouldRelease = !tempVar && !keepTempVar;
      tempVar = tempVar || self.getTempVar();
      var result = self.explodeExpression(childPath, ignoreChildResult);

      // always mark!
      result = self.emitAssign(
        tempVar,
        result,
        childPath.node.loc
      );

      self.markAndBreak();

      if(shouldRelease) {
        self.releaseTempVar();
      }
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
        ? explodeViaTempVar(null, path.get("property"), false, true)
        : expr.property,
      expr.computed
    ), path.node.loc));

  case "CallExpression":
    var oldCalleePath = path.get("callee");
    var callArgs = path.get("arguments");

    if(oldCalleePath.node.type === "Identifier" &&
       oldCalleePath.node.name === "callCC") {
      callArgs = [new types.NodePath(
        withLoc(b.callExpression(
          b.memberExpression(b.identifier("VM"),
                             b.identifier("callCC"),
                             false),
          []
        ), oldCalleePath.node.loc)
      )];
      oldCalleePath = path.get("arguments").get(0);
    }

    var newCallee = self.explodeExpression(oldCalleePath);

    var r = self.withTempVars(function() {
      var after = loc();
      var args = callArgs.map(function(argPath) {
        return explodeViaTempVar(null, argPath, false, true);
      });
      var tmp = self.getTempVar();
      var callee = newCallee;

      self.emitAssign(b.identifier('$__next'), after, path.node.loc);
      self.emitAssign(b.identifier('$__tmpid'), b.literal(self.currentTempId()));
      self.emitAssign(tmp, b.callExpression(callee, args));

      self.emit(b.breakStatement(), true);
      self.mark(after);

      return tmp;
    });

    return r;

  case "NewExpression":
    // TODO: this should be the last major expression type I need to
    // fix up to be able to trace/step through. can't call native new
    return self.withTempVars(function() {
      return finish(b.newExpression(
        explodeViaTempVar(null, path.get("callee"), false, true),
        path.get("arguments").map(function(argPath) {
          return explodeViaTempVar(null, argPath, false, true);
        })
      ));
    });

  case "ObjectExpression":
    return self.withTempVars(function() {
      return finish(b.objectExpression(
        path.get("properties").map(function(propPath) {
          return b.property(
            propPath.value.kind,
            propPath.value.key,
            explodeViaTempVar(null, propPath.get("value"), false, true)
          );
        })
      ));
    });

  case "ArrayExpression":
    return self.withTempVars(function() {
      return finish(b.arrayExpression(
        path.get("elements").map(function(elemPath) {
          return explodeViaTempVar(null, elemPath, false, true);
        })
      ));
    });

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

    self.withTempVars(function() {
      if (!ignoreResult) {
        result = self.getTempVar();
      }

      var left = explodeViaTempVar(result, path.get("left"), false, true);

      if (expr.operator === "&&") {
        self.jumpIfNot(left, after, path.get("left").node.loc);
      } else if (expr.operator === "||") {
        self.jumpIf(left, after, path.get("left").node.loc);
      }

      explodeViaTempVar(result, path.get("right"), ignoreResult, true);

      self.mark(after);
    });

    return result;

  case "ConditionalExpression":
    var elseLoc = loc();
    var after = loc();
    var test = self.explodeExpression(path.get("test"));

    self.jumpIfNot(test, elseLoc, path.get("test").node.loc);

    if (!ignoreResult) {
      result = self.getTempVar();
    }

    explodeViaTempVar(result, path.get("consequent"), ignoreResult);
    self.jump(after);

    self.mark(elseLoc);
    explodeViaTempVar(result, path.get("alternate"), ignoreResult);

    self.mark(after);

    if(!ignoreResult) {
      self.releaseTempVar();
    }

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
    return self.withTempVars(function() {
      return finish(withLoc(b.binaryExpression(
        expr.operator,
        explodeViaTempVar(null, path.get("left"), false, true),
        explodeViaTempVar(null, path.get("right"), false, true)
      ), path.node.loc));
    });

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
    ), path.node.loc));

  // case "YieldExpression":
  //   var after = loc();
  //   var arg = expr.argument && self.explodeExpression(path.get("argument"));

  //   if (arg && expr.delegate) {
  //     var result = self.getTempVar();

  //     self.emit(b.returnStatement(b.callExpression(
  //       self.contextProperty("delegateYield"), [
  //         arg,
  //         b.literal(result.property.name),
  //         after
  //       ]
  //     )));

  //     self.mark(after);

  //     return result;
  //   }

    // self.emitAssign(b.identifier('$__next'), after);
    // self.emit(b.returnStatement(arg || null));
    // self.mark(after);

    // return self.contextProperty("sent");

  case "Identifier":
  case "FunctionExpression":
  case "ArrowFunctionExpression":
  case "ThisExpression":
  case "Literal":
    return finish(expr);
    break;

  default:
    throw new Error(
      "unknown Expression of type " +
        JSON.stringify(expr.type));
  }
};
