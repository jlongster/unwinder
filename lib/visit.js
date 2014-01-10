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

    //rootFn.body.body.unshift(b.expressionStatement(b.literal(5)));

    ast.body = [debugInfo.getDebugInfo(),
                b.expressionStatement(
                    b.callExpression(
                        b.identifier('invokeRoot'), [rootFn, b.identifier('this')]
                    )
                )];

    return ast;
};

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

    // TODO Ensure these identifiers are named uniquely.
    var contextId = b.identifier("$ctx");
    var nameId = node.id;
    var functionId = node.id ? b.identifier(node.id.name + "$") : null/*Anonymous*/;
    var argsId = b.identifier("$args");
    var invokeFunctionId = b.identifier("invokeFunction");
    var shouldAliasArguments = renameArguments(node, argsId);
    var vars = hoist(node);

    if (shouldAliasArguments) {
        vars = vars || b.variableDeclaration("var", []);
        vars.declarations.push(b.variableDeclarator(
            argsId, b.identifier("arguments")
        ));
    }

    var emitter = new Emitter(contextId, debugId, debugInfo);
    var path = new types.NodePath(node);

    emitter.explode(path.get("body"));

    var outerBody = [];

    if (vars && vars.declarations.length > 0) {
        outerBody.push(vars);
    }

    outerBody.push(b.returnStatement(
        b.callExpression(invokeFunctionId, [
            b.literal(nameId ? nameId.name : '<anon>'),
            b.literal(debugId),
            emitter.getContextFunction(functionId, function(ast) {
              return types.traverse(ast, function(node) {
                  return visitNode(node, debugInfo);
              });
            }),
            b.thisExpression()
        ])
    ));

    node.body = b.blockStatement(outerBody);

    return false;
}

function renameArguments(func, argsId) {
    var didReplaceArguments = false;
    var hasImplicitArguments = false;

    types.traverse(func, function(node) {
        if (node === func) {
            hasImplicitArguments = !this.scope.lookup("arguments");
        } else if (n.Function.check(node)) {
            return false;
        }

        if (n.Identifier.check(node) && node.name === "arguments") {
            var isMemberProperty =
                n.MemberExpression.check(this.parent.node) &&
                this.name === "property" &&
                !this.parent.node.computed;

            if (!isMemberProperty) {
                this.replace(argsId);
                didReplaceArguments = true;
                return false;
            }
        }
    });

    // If the traversal replaced any arguments identifiers, and those
    // identifiers were free variables, then we need to alias the outer
    // function's arguments object to the variable named by argsId.
    return didReplaceArguments && hasImplicitArguments;
}
