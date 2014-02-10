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
var escope = require('escope');
var withLoc = require("./util").withLoc;

exports.transform = function(ast, opts) {
  n.Program.assert(ast);
  var debugInfo = new DebugInfo();
  var nodes = ast.body;
  var asExpr = opts.asExpr;
  var originalExpr = nodes[0];
  var boxedVars = (opts.scope || []).reduce(function(acc, v) {
    if(v.boxed) {
      acc.push(v.name);
    }
    return acc;
  }, []);

  var scopes = escope.analyze(ast).scopes;

  // Scan the scopes bottom-up by simply reversing the array. We need
  // this because we need to detect if an identifier is boxed before
  // the scope which it is declared in is scanned.

  scopes.reverse();
  scopes.forEach(function(scope) {
    if(scope.type !== 'global' || asExpr) {

      if(asExpr) {
        // We need to also scan the variables to catch top-level
        // definitions that aren't referenced but might be boxed
        // (think function re-definitions)
        scope.variables.forEach(function(v) {
          if(boxedVars.indexOf(v.name) !== -1) {
            v.defs.forEach(function(def) { def.name.boxed = true; });
          }
        });
      }

      scope.references.forEach(function(r) {
        var defBoxed = r.resolved && r.resolved.defs.reduce(function(acc, def) {
          return acc || def.name.boxed || boxedVars.indexOf(def.name) !== -1;
        }, false);

        if(defBoxed ||
           (!r.resolved &&
            boxedVars.indexOf(r.identifier.name) !== -1) ||
           (r.resolved &&
            r.resolved.scope !== r.from &&

            // completely ignore references to a named function
            // expression, as that binding is immutabled (super weird)
            !(r.resolved.defs[0].type === 'FunctionName' &&
              r.resolved.defs[0].node.type === 'FunctionExpression'))) {

          r.identifier.boxed = true;

          if(r.resolved) {
            r.resolved.defs.forEach(function(def) {
              def.name.boxed = true;
            });
          }
        }
      });
    }
  });

  if(asExpr) {
    // If evaluating as an expression, return the last value if it's
    // an expression
    var last = nodes.length - 1;

    if(n.ExpressionStatement.check(nodes[last])) {
      nodes[last] = withLoc(
        b.returnStatement(nodes[last].expression),
        nodes[last].loc
      );
    }
  }

  nodes = b.functionExpression(
    b.identifier(asExpr ? '$__eval' : '$__global'),
    [],
    b.blockStatement(nodes)
  );

  var rootFn = types.traverse(
    nodes,
    function(node) {
      return visitNode.call(this, node, [], debugInfo);
    }
  );

  if(asExpr) {
    rootFn = rootFn.body.body;

    if(opts.scope) {
      var vars = opts.scope.map(function(v) { return v.name; });
      var decl = rootFn[0];
      if(n.VariableDeclaration.check(decl)) {
        decl.declarations = decl.declarations.reduce(function(acc, v) {
          if(vars.indexOf(v.id.name) === -1) {
            acc.push(v);
          }
          return acc;
        }, []);

        if(!decl.declarations.length) {
          rootFn[0] = b.expressionStatement(b.literal(null));
        }
      }
    }
    else {
      rootFn[0] = b.expressionStatement(b.literal(null));
    }

    var ctx = b.memberExpression(
      b.identifier('$__eval'),
      b.identifier('$ctx'),
      false
    );

    rootFn.unshift(b.expressionStatement(
      b.callExpression(
        b.memberExpression(
          b.identifier('VM'),
          b.identifier('pushState'),
          false
        ),
        []
      )
    ));

    rootFn.push(
      b.expressionStatement(
        b.assignmentExpression(
          '=',
          ctx,
          b.callExpression(
            b.memberExpression(
              b.identifier('VM'),
              b.identifier('getContext'),
              false
            ),
            []
          )
        )
      )
    );

    rootFn.push(b.variableDeclaration(
      'var',
      [b.variableDeclarator(
        b.identifier('$__rval'),
        b.callExpression(b.identifier('$__eval'), [])
      )]
    ));

    rootFn.push(b.expressionStatement(
      b.callExpression(
        b.memberExpression(
          b.identifier('VM'),
          b.identifier('popState'),
          false
        ),
        []
      )
    ));

    rootFn.push(b.expressionStatement(b.identifier('$__rval')));
  }
  else {
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
  if(n.Identifier.check(node) &&
     (!n.VariableDeclarator.check(this.parent.node) ||
      this.parent.node.id !== node) &&
     node.boxed) {

    this.replace(withLoc(b.memberExpression(node, b.literal(0), true),
                         node.loc));
    return;
  }

  if(!n.Function.check(node)) {
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

  // All functions are converted with assignments (foo = function
  // foo() {}) but with the function name. Rename the function though
  // so that if it is referenced inside itself, it will close over the
  // "outside" variable (that should be boxed)
  node.id = node.id || newFunctionName();
  var isGlobal = node.id.name === '$__global';
  var isExpr = node.id.name === '$__eval';
  var nameId = node.id;
  var funcName = node.id.name;
  var contextId = b.identifier('$ctx');
  var vars = hoist(node);
  var localScope = !vars ? node.params : node.params.concat(
    vars.declarations.map(function(v) {
      return v.id;
    })
  );

  // It sucks to traverse the whole function again, but we need to see
  // if we need to manage a try stack
  var hasTry = false;
  types.traverse(node.body, function(child) {
    if(n.Function.check(child)) {
      return false;
    }
    
    if(n.TryStatement.check(child)) {
      hasTry = true;
    }

    return;
  });

  // Traverse and compile child functions first
  node.body = types.traverse(node.body, function(child) {
    return visitNode.call(this,
                          child,
                          scope.concat(localScope),
                          debugInfo);
  });

  // Now compile me
  var em = new Emitter(contextId, debugId, debugInfo);
  var path = new types.NodePath(node);

  em.explode(path.get("body"));

  var machine = em.getMachine(node.id.name, localScope);
  var finalBody = machine.ast;

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
             b.literal(funcName.slice(1)),
             b.identifier(funcName),
             b.objectExpression(
               localScope.map(function(id) {
                 return b.property(
                   'init',
                   b.literal(id.name),
                   id
                 );
               })
             ),
             b.arrayExpression(localScope.concat(scope).map(function(id) {
               return b.objectExpression([
                 b.property('init', b.literal('name'), b.literal(id.name)),
                 b.property('init', b.literal('boxed'), b.literal(!!id.boxed))
               ]);
             })),
             b.thisExpression(),
             hasTry ? b.identifier('tryStack') : b.literal(null),
             contextId,
             em.contextProperty('childFrame')]
          )
        )
      ),

      // clean up the function
      em.assign(em.getProperty(funcName, '$ctx'), b.identifier('undefined'))
    ]);
  }

  var inner = [];

  if(!isGlobal && !isExpr) {
    node.params.forEach(function(arg) {
      if(arg.boxed) {
        inner.push(b.expressionStatement(
          b.assignmentExpression(
            '=',
            arg,
            b.arrayExpression([arg])
          )
        ));
      }
    });

    if(vars) {
      inner = inner.concat(vars);
    }
  }

  inner.push(
    b.variableDeclaration('var', [
      b.variableDeclarator(
        b.identifier(machine.contextId),
        b.memberExpression(node.id, b.identifier('$ctx'), false)
      )
    ])
  );

  if(!isGlobal && !isExpr) {
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

  if(hasTry) {
    inner.push(em.declareVar('tryStack', b.arrayExpression([])));
  }

  inner = inner.concat([
    b.tryStatement(
      b.blockStatement([getRestoration(em, isGlobal, localScope, hasTry)]
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

  if(isGlobal || isExpr) {
    node.body = b.blockStatement([
      vars ? vars : b.expressionStatement(b.literal(null)),
      b.functionDeclaration(
          nameId, [],
          b.blockStatement(inner)
      )
    ]);
  }
  else {
    node.body = b.blockStatement(inner);
  }

  return false;
}

function getRestoration(self, isGlobal, localScope, hasTry) {
  // restoring a frame
  var restoration = [];

  if(!isGlobal) {
    restoration = localScope.map(function(id) {
      return b.expressionStatement(
        b.assignmentExpression(
          '=',
          b.identifier(id.name),
          self.getProperty(
            self.getProperty(self.contextProperty('frame'), 'state'),
            id
          )
        )
      );
    });
  }

  if(hasTry) {
    restoration.push(
      self.assign(b.identifier('tryStack'), 
                  self.getProperty(self.contextProperty('frame'), 'tryStack'))
    );
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
