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

exports.transform = function(ast, opts) {
  n.Program.assert(ast);
  var debugInfo = new DebugInfo();
  var nodes = ast.body;
  var isFunction = nodes.length === 1 && n.Function.check(nodes[0]);

  if(!isFunction) {
    nodes = b.functionExpression(
      b.identifier('$__global'),
      [],
      b.blockStatement(nodes)
    );
  }

  var rootFn = types.traverse(
    nodes,
    function(node) {
      return visitNode(node, [], debugInfo);
    }
  );

  if(!isFunction) {
    rootFn = rootFn.body.body;
  }

  ast.body = rootFn;

  return {
    ast: ast,
    debugAST: opts.includeDebug ? [debugInfo.getDebugAST()] : [],
    debugInfo: debugInfo.getDebugInfo()
  };
};

var id = 1;
function newFunctionName() {
  return b.identifier('$anon' + id++);
}

function visitNode(node, scope, debugInfo) {
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

  // TODO: Ensure these identifiers are named uniquely.
  var nameId = node.id;
  node.id = node.id || newFunctionName();
  var isGlobal = node.id.name === '$__global';
  var funcName = node.id.name;
  var contextId = b.identifier('$ctx');
  var vars = hoist(node);
  var argNames = node.params.map(function(v) { return v.name; });
  var varNames = !vars ? argNames : argNames.concat(
    vars.declarations.map(function(v) {
      return v.id.name;
    })
  );

  var em = new Emitter(contextId, debugId, debugInfo);
  var path = new types.NodePath(node);

  em.explode(path.get("body"));

  var machine = em.getMachine(node.id.name, varNames, scope);
  var finalBody = types.traverse(machine.ast, function(node) {
    return visitNode(node,
                     varNames.concat(scope),
                     debugInfo);
  });

  // construct the thing

  function addSnapshot(arr) {
    arr.push.apply(arr, [
      // if it falls out of the loops, that means we've paused so create
      // a frame
      b.expressionStatement(
        b.assignmentExpression(
          '=',
          em.contextProperty('frame'),
          b.newExpression(
            b.identifier('$Frame'),
            [b.literal(debugId),
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
             contextId,
             em.contextProperty('childFrame')]
          )
        )
      ),

      // clean up the function
      em.assign(em.getProperty(funcName, '$ctx'), b.identifier('undefined'))
    ]);
  }

  var inner = (vars && !isGlobal) ? [vars] : [];

  inner.push(
    b.variableDeclaration('var', [
      b.variableDeclarator(
        b.identifier(machine.contextId),
        b.memberExpression(node.id, b.identifier('$ctx'), false)
      )
    ])
  );

  if(!isGlobal) {
    inner.push.apply(inner, [
      b.ifStatement(
        b.binaryExpression('===',
                           b.identifier('$ctx'),
                           b.identifier('undefined')), // is "identifier" right?
        b.returnStatement(
          b.callExpression(
            b.memberExpression(b.identifier('VM'),
                               b.identifier('execute'),
                               false),
            [node.id, b.literal(null), b.thisExpression(), b.identifier('arguments')]
          )
        )
      ),
      b.expressionStatement(
        b.assignmentExpression(
          '=',
          b.memberExpression(b.identifier('$ctx'), b.identifier('isCompiled'),
                             false),
          b.literal(true)
        )
      )
    ]);
  }

  inner = inner.concat([
    b.tryStatement(
      b.blockStatement([getRestoration(em, isGlobal, varNames)]
                       .concat(finalBody)),
      b.catchClause(b.identifier('e'), null, b.blockStatement([
        b.expressionStatement(
          b.assignmentExpression(
            '=',
            b.memberExpression(b.identifier('VM'), b.identifier('error'), false),
            b.identifier('e')
          )
        )
      ]))
    )
  ]);
  addSnapshot(inner);

  if(isGlobal) {
    node.body = b.blockStatement([
      vars ? vars : b.expressionStatement(b.literal(null)),
      b.functionDeclaration(
          nameId, [],
          b.blockStatement(inner)
      ),
      b.returnStatement(nameId)
    ]);
  }
  else {
    node.body = b.blockStatement(inner);
  }

  return false;
}

function getRestoration(self, isGlobal, varNames) {
  // restoring a frame
  var restoration = [];

  if(!isGlobal) {
    restoration = varNames.map(function(v) {
      return b.expressionStatement(
        b.assignmentExpression(
          '=',
          b.identifier(v),
          self.getProperty(
            self.getProperty(self.contextProperty('frame'), 'scope'), v
          )
        )
      );
    });
  }

  restoration = restoration.concat([
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

  return b.ifStatement(
    self.contextProperty('frame'),
    b.blockStatement(restoration),
    b.ifStatement(
      // if we are stepping, stop executing so it is stopped at
      // the first instruction of the new frame
      self.vmProperty('stepping'),
      b.throwStatement(b.literal(null))
    )
  );
}
