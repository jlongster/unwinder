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

        // Ignore catch scopes
        var from = r.from;
        while(from.type == 'catch' && from.upper) {
          from = from.upper;
        }

        if(defBoxed ||
           (!r.resolved &&
            boxedVars.indexOf(r.identifier.name) !== -1) ||
           (r.resolved &&
            r.resolved.scope.type !== 'catch' &&
            r.resolved.scope !== from &&

            // completely ignore references to a named function
            // expression, as that binding is immutable (super weird)
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
  // Boxed variables need to access the box instead of used directly
  // (foo => foo[0])
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

  node.generator = false;

  if (node.expression) {
    // Transform expression lambdas into normal functions.
    node.expression = false;
    // This feels very dirty, is it ok to change the type like this?
    // We need to output a function that we can name so it can be
    // captured.
    // TODO: properly compile out arrow functions
    node.type = 'FunctionExpression';
    node.body = b.blockStatement([
      withLoc(b.returnStatement(node.body),
              node.body.loc)
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
  var debugId = debugInfo.makeId();
  var em = new Emitter(debugId, debugInfo);
  var path = new types.NodePath(node);

  em.explode(path.get("body"));

  var finalBody = em.getMachine(node.id.name, localScope);

  // construct the thing
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

  if(!isGlobal && !isExpr) {
    inner.push.apply(inner, [
      b.ifStatement(
        b.unaryExpression('!', em.vmProperty('running')),
        b.returnStatement(
          b.callExpression(
            b.memberExpression(b.identifier('VM'),
                               b.identifier('execute'),
                               false),
            [node.id, b.thisExpression(), b.identifier('arguments')]
          )
        )
      )
    ]);
  }

  // internal harnesses to run the function
  inner.push(em.declareVar('$__next', b.literal(0)));
  inner.push(em.declareVar('$__tmpid', b.literal(0)));
  for(var i=1, l=em.numTempVars(); i<=l; i++) {
    inner.push(em.declareVar('$__t' + i, null));
  }

  if(hasTry) {
    inner.push(em.declareVar('tryStack', b.arrayExpression([])));
  }

  var tmpSave = [];
  for(var i=1, l=em.numTempVars(); i<=l; i++) {
    tmpSave.push(b.property(
      'init',
      b.identifier('$__t' + i),
      b.identifier('$__t' + i)
    ));
  }

  inner = inner.concat([
    b.tryStatement(
      b.blockStatement(getRestoration(em, isGlobal, localScope, hasTry)
                       .concat(finalBody)),
      b.catchClause(b.identifier('e'), null, b.blockStatement([
        b.ifStatement(
          b.unaryExpression(
            '!',
            b.binaryExpression('instanceof',
                               b.identifier('e'),
                               b.identifier('$ContinuationExc'))
          ),
          b.expressionStatement(
            b.assignmentExpression(
              '=',
              b.identifier('e'),
              b.newExpression(
                b.identifier('$ContinuationExc'),
                [b.identifier('e')]
              )
            )
          )
        ),

        b.ifStatement(
          b.unaryExpression('!', em.getProperty('e', 'reuse')),
          b.expressionStatement(
            b.callExpression(em.getProperty('e', 'pushFrame'), [
              b.newExpression(
                b.identifier('$Frame'),
                [b.literal(debugId),
                 b.literal(funcName.slice(1)),
                 b.identifier(funcName),
                 b.identifier('$__next'),
                 b.objectExpression(
                   localScope.map(function(id) {
                     return b.property('init', id, id);
                   }).concat(tmpSave)
                 ),
                 // b.literal(null),
                 b.arrayExpression(localScope.concat(scope).map(function(id) {
                   return b.objectExpression([
                     b.property('init', b.literal('name'), b.literal(id.name)),
                     b.property('init', b.literal('boxed'), b.literal(!!id.boxed))
                   ]);
                 })),
                 b.thisExpression(),
                 hasTry ? b.identifier('tryStack') : b.literal(null),
                 b.identifier('$__tmpid')]
              )
            ])
          )
        ),

        em.assign(em.getProperty('e', 'reuse'), b.literal(false)),
        b.throwStatement(b.identifier('e'))
      ]))
    )
  ]);

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

  restoration.push(
    self.declareVar(
      '$__frame',
      b.callExpression(self.vmProperty('popFrame'), [])
    )
  );

  if(!isGlobal) {
    restoration = restoration.concat(localScope.map(function(id) {
      return b.expressionStatement(
        b.assignmentExpression(
          '=',
          b.identifier(id.name),
          self.getProperty(
            self.getProperty(b.identifier('$__frame'), 'state'),
            id
          )
        )
      );
    }));
  }

  restoration.push(
    self.assign(b.identifier('$__next'),
                self.getProperty(b.identifier('$__frame'), 'next'))
  );
  if(hasTry) {
    restoration.push(
      self.assign(b.identifier('tryStack'),
                  self.getProperty(b.identifier('$__frame'), 'tryStack'))
    );
  }

  restoration = restoration.concat([
    self.declareVar(
      '$__child',
      b.callExpression(self.vmProperty('nextFrame'), [])
    ),
    self.assign(b.identifier('$__tmpid'),
                self.getProperty(b.identifier('$__frame'), 'tmpid')),
    b.ifStatement(
      b.identifier('$__child'),
      b.blockStatement([
        self.assign(
          self.getProperty(
            self.getProperty(
              '$__frame',
              b.identifier('state')
            ),
            b.binaryExpression(
              '+',
              b.literal('$__t'),
              self.getProperty('$__frame', 'tmpid')
            ),
            true
          ),
          b.callExpression(
            self.getProperty(self.getProperty('$__child', 'fn'), 'call'),
            [self.getProperty('$__child', 'thisPtr')]
          )
        ),

        // if we are stepping, stop executing here so that it
        // pauses on the "return" instruction
        b.ifStatement(
          self.vmProperty('stepping'),
          b.throwStatement(
            b.newExpression(b.identifier('$ContinuationExc'), 
                            [b.literal(null),
                             b.identifier('$__frame')])
          )
        )
      ])
    )
  ]);

  for(var i=1, l=self.numTempVars(); i<=l; i++) {
    restoration.push(b.expressionStatement(
      b.assignmentExpression(
        '=',
        b.identifier('$__t' + i),
        self.getProperty(
          self.getProperty(b.identifier('$__frame'), 'state'),
          '$__t' + i
        )
      )
    ));
  }

  return [
    b.ifStatement(
      self.vmProperty('doRestore'),
      b.blockStatement(restoration),
      b.ifStatement(
        // if we are stepping, stop executing so it is stopped at
        // the first instruction of the new frame
        self.vmProperty('stepping'),
        b.throwStatement(
          b.newExpression(b.identifier('$ContinuationExc'), [])
        )
      )
    )
  ];
}
