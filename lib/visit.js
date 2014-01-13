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
var n = types.namedTypes;
var b = types.builders;
var hoist = require("./hoist").hoist;
var Emitter = require("./emit").Emitter;
var DebugInfo = require("./debug").DebugInfo;

exports.transform = function(ast) {
  n.Program.assert(ast);

  var debugInfo = new DebugInfo();
  var rootFn = types.traverse(
    b.functionExpression(
      null, [],
      b.blockStatement(ast.body)
    ),
    function(node) {
      return visitNode(node, debugInfo);
    }
  );

  ast.body = [debugInfo.getDebugInfo(),
              b.expressionStatement(
                b.callExpression(
                  b.identifier('invokeRoot'), [rootFn, b.identifier('this')]
                )
              )];

  return ast;
};

var id = 1;
function newFunctionName() {
  return b.identifier('$anon' + id++);
}

function visitNode(node, debugInfo) {
  if (!n.Function.check(node)) {
    // Note that because we are not returning false here the traversal
    // will continue into the subtree rooted at this node, as desired.
    return;
  }

  var debugId = debugInfo.makeId();
  node.generator = false;

  if (node.expression) {
    // Transform expression lambdas into normal functions.
    node.expression = false;
    node.body = b.blockStatement([
      b.returnStatement(node.body)
    ]);
  }

  // transform bottom-up
  node.body = types.traverse(node.body, function(node) {
    return visitNode(node, debugInfo);
  });

  // TODO: Ensure these identifiers are named uniquely.
  var contextId = b.identifier("$ctx");
  var nameId = node.id;
  node.id = node.id || newFunctionName();
  var vars = hoist(node);

  var emitter = new Emitter(contextId, debugId, debugInfo);
  var path = new types.NodePath(node);

  emitter.explode(path.get("body"));

  var machine = emitter.getMachine();

  var inner = vars ? [vars] : [];
  inner.push.apply(inner, [
    b.variableDeclaration(
      'var',
      [b.variableDeclarator(
        b.identifier(machine.contextId),
        b.memberExpression(node.id, b.identifier('$ctx'), false)
      )]
    ),
    b.expressionStatement(
      b.assignmentExpression(
        '=',
        b.memberExpression(b.identifier('$ctx'), b.identifier('isCompiled'),
                           false),
        b.literal(true)
      )
    ),
    machine.ast
  ]);

  node.body = b.blockStatement(inner);
  return false;
}

function renameIdentifier(func, id, newId) {
  var didReplace = false;
  var hasImplicit = false;

  types.traverse(func, function(node) {
    if (node === func) {
      hasImplicit = !this.scope.lookup(id);
    } else if (n.Function.check(node)) {
      return false;
    }

    if ((n.Identifier.check(node) && node.name === id) ||
        (n.ThisExpression.check(node) && id === 'this')) {
      var isMemberProperty =
        n.MemberExpression.check(this.parent.node) &&
        this.name === "property" &&
        !this.parent.node.computed;

      if (!isMemberProperty) {
        this.replace(newId);
        didReplace = true;
        return false;
      }
    }
  });

  // If the traversal replaced any arguments identifiers, and those
  // identifiers were free variables, then we need to alias the outer
  // function's arguments object to the variable named by newId.
  return didReplace && hasImplicit;
}
