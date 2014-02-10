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
var hasOwn = Object.prototype.hasOwnProperty;
var withLoc = require("./util").withLoc;

// The hoist function takes a FunctionExpression or FunctionDeclaration
// and replaces any Declaration nodes in its body with assignments, then
// returns a VariableDeclaration containing just the names of the removed
// declarations.
exports.hoist = function(fun) {
  n.Function.assert(fun);
  var vars = {};
  var funDeclsToRaise = [];

  function varDeclToExpr(vdec, includeIdentifiers) {
    n.VariableDeclaration.assert(vdec);
    var exprs = [];

    vdec.declarations.forEach(function(dec) {
      vars[dec.id.name] = dec.id;

      if (dec.init) {
        var assn = b.assignmentExpression('=', dec.id, dec.init);

        exprs.push(withLoc(assn, dec.loc));
      } else if (includeIdentifiers) {
        exprs.push(dec.id);
      }
    });

    if (exprs.length === 0)
      return null;

    if (exprs.length === 1)
      return exprs[0];

    return b.sequenceExpression(exprs);
  }

  types.traverse(fun.body, function(node) {
    if (n.VariableDeclaration.check(node)) {
      var expr = varDeclToExpr(node, false);
      if (expr === null) {
        this.replace();
      } else {
        // We don't need to traverse this expression any further because
        // there can't be any new declarations inside an expression.
        this.replace(withLoc(b.expressionStatement(expr), node.loc));
      }

      // Since the original node has been either removed or replaced,
      // avoid traversing it any further.
      return false;

    } else if (n.ForStatement.check(node)) {
      if (n.VariableDeclaration.check(node.init)) {
        var expr = varDeclToExpr(node.init, false);
        this.get("init").replace(expr);
      }

    } else if (n.ForInStatement.check(node)) {
      if (n.VariableDeclaration.check(node.left)) {
        var expr = varDeclToExpr(node.left, true);
        this.get("left").replace(expr);
      }

    } else if (n.FunctionDeclaration.check(node)) {
      vars[node.id.name] = node.id;

      var parentNode = this.parent.node;
      // Prefix the name with '$' as it introduces a new scoping rule
      // and we want the original id to be referenced within the body
      var funcExpr = b.functionExpression(
        b.identifier('$' + node.id.name),
        node.params,
        node.body,
        node.generator,
        node.expression
      );
      funcExpr.loc = node.loc;

      var assignment = withLoc(b.expressionStatement(
        withLoc(b.assignmentExpression(
          "=",
          node.id,
          funcExpr
        ), node.loc)
      ), node.loc);

      if (n.BlockStatement.check(this.parent.node)) {
        // unshift because later it will be added in reverse, so this
        // will keep the original order
        funDeclsToRaise.unshift({
          block: this.parent.node,
          assignment: assignment
        });

        // Remove the function declaration for now, but reinsert the assignment
        // form later, at the top of the enclosing BlockStatement.
        this.replace();

      } else {
        this.replace(assignment);
      }

      // Don't hoist variables out of inner functions.
      return false;

    } else if (n.FunctionExpression.check(node)) {
      // Don't descend into nested function expressions.
      return false;
    }
  });

  funDeclsToRaise.forEach(function(entry) {
    entry.block.body.unshift(entry.assignment);
  });

  var declarations = [];
  var paramNames = {};

  fun.params.forEach(function(param) {
    if (n.Identifier.check(param)) {
      paramNames[param.name] = param;
    }
    else {
      // Variables declared by destructuring parameter patterns will be
      // harmlessly re-declared.
    }
  });

  Object.keys(vars).forEach(function(name) {
    if(!hasOwn.call(paramNames, name)) {
      var id = vars[name];
      declarations.push(b.variableDeclarator(
        id, id.boxed ? b.arrayExpression([b.identifier('undefined')]) : null
      ));
    }
  });

  if (declarations.length === 0) {
    return null; // Be sure to handle this case!
  }

  return b.variableDeclaration("var", declarations);
};
